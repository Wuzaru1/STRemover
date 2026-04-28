#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::fs;
use std::path::PathBuf;
use winreg::RegKey;
use winreg::enums::HKEY_CURRENT_USER;

// Get Steam installation path from Windows registry
fn get_steam_path() -> Option<PathBuf> {
    // Try Steam registry key
    if let Ok(steam_key) = RegKey::predef(HKEY_CURRENT_USER).open_subkey("Software\\Valve\\Steam") {
        if let Ok(steam_path) = steam_key.get_value::<String, _>("SteamPath") {
            let path = PathBuf::from(steam_path);
            if path.exists() {
                return Some(path);
            }
        }
        if let Ok(steam_path) = steam_key.get_value::<String, _>("InstallPath") {
            let path = PathBuf::from(steam_path);
            if path.exists() {
                return Some(path);
            }
        }
    }
    
    // Fallback to common paths
    let common_paths = vec![
        "C:/Program Files (x86)/Steam",
        "C:/Program Files/Steam",
        "D:/Steam",
        "E:/Steam",
    ];
    
    for path_str in common_paths {
        let path = PathBuf::from(path_str);
        if path.exists() {
            return Some(path);
        }
    }
    
    None
}

// Helper to format file count with proper singular/plural
fn format_file_count(count: u64, singular: &str, plural: &str) -> String {
    if count == 1 {
        format!("1 {}", singular)
    } else {
        format!("{} {}", count, plural)
    }
}

#[tauri::command]
fn remove_lua_files(appid: u64) -> Result<(u64, bool), String> {
    let steam_path = get_steam_path()
        .ok_or("Could not find Steam installation. Please verify Steam is installed.")?;
    
    // Lua files are in Steam/config/stplug-in
    let stplug_path = steam_path.join("config").join("stplug-in");
    
    let mut removed_count = 0u64;
    let mut found_any = false;

    if stplug_path.exists() {
        // Remove all .lua files related to this appid
        if let Ok(entries) = fs::read_dir(&stplug_path) {
            for entry in entries.flatten() {
                let entry_path = entry.path();
                let file_name = entry_path.file_name()
                    .and_then(|n| n.to_str())
                    .unwrap_or("");
                
                // Check if file contains the appid and is a lua file
                if file_name.contains(&appid.to_string()) && 
                   entry_path.extension().map_or(false, |ext| ext == "lua") {
                    found_any = true;
                    if fs::remove_file(&entry_path).is_ok() {
                        removed_count += 1;
                    }
                }
            }
        }
    }

    // Also check workshop content directory
    let workshop_path = steam_path.join("steamapps").join("workshop").join("content").join(appid.to_string());
    if workshop_path.exists() {
        if let Ok(entries) = fs::read_dir(&workshop_path) {
            for entry in entries.flatten() {
                let entry_path = entry.path();
                if entry_path.is_dir() {
                    if let Ok(sub_entries) = fs::read_dir(&entry_path) {
                        for sub_entry in sub_entries.flatten() {
                            let sub_path = sub_entry.path();
                            if sub_path.extension().map_or(false, |ext| ext == "lua") {
                                found_any = true;
                                if fs::remove_file(&sub_path).is_ok() {
                                    removed_count += 1;
                                }
                            }
                        }
                    }
                } else if entry_path.extension().map_or(false, |ext| ext == "lua") {
                    found_any = true;
                    if fs::remove_file(&entry_path).is_ok() {
                        removed_count += 1;
                    }
                }
            }
        }
    }

    Ok((removed_count, found_any))
}

#[tauri::command]
fn remove_manifests(depot_ids: Vec<u64>) -> Result<u64, String> {
    let steam_path = get_steam_path()
        .ok_or("Could not find Steam installation. Please verify Steam is installed.")?;
    
    // Manifest files are in Steam/config/depotcache
    let depotcache_path = steam_path.join("config").join("depotcache");

    let mut removed_count = 0u64;

    if depotcache_path.exists() {
        if let Ok(entries) = fs::read_dir(&depotcache_path) {
            for entry in entries.flatten() {
                let entry_path = entry.path();
                let file_name = entry_path.file_name()
                    .and_then(|n| n.to_str())
                    .unwrap_or("");

                // Check if the file matches any of the depot IDs
                for depot_id in &depot_ids {
                    if file_name.contains(&depot_id.to_string()) && file_name.ends_with(".manifest") {
                        if fs::remove_file(&entry_path).is_ok() {
                            removed_count += 1;
                        }
                        break;
                    }
                }
            }
        }
    }

    // Also check appcache/depotcache
    let alt_depotcache = steam_path.join("appcache").join("depotcache");
    if alt_depotcache.exists() {
        if let Ok(entries) = fs::read_dir(&alt_depotcache) {
            for entry in entries.flatten() {
                let entry_path = entry.path();
                let file_name = entry_path.file_name()
                    .and_then(|n| n.to_str())
                    .unwrap_or("");

                for depot_id in &depot_ids {
                    if file_name.contains(&depot_id.to_string()) {
                        if fs::remove_file(&entry_path).is_ok() {
                            removed_count += 1;
                        }
                        break;
                    }
                }
            }
        }
    }

    Ok(removed_count)
}

// Check if game exists in stplug-in
fn game_has_lua_files(appid: u64) -> bool {
    if let Some(steam_path) = get_steam_path() {
        let stplug_path = steam_path.join("config").join("stplug-in");
        if stplug_path.exists() {
            if let Ok(entries) = fs::read_dir(&stplug_path) {
                for entry in entries.flatten() {
                    let entry_path = entry.path();
                    let file_name = entry_path.file_name()
                        .and_then(|n| n.to_str())
                        .unwrap_or("");
                    if file_name.contains(&appid.to_string()) && 
                       entry_path.extension().map_or(false, |ext| ext == "lua") {
                        return true;
                    }
                }
            }
        }
    }
    false
}

#[tauri::command]
fn remove_all(appid: u64, depot_ids: Vec<u64>) -> Result<String, String> {
    // Check if game exists in stplug-in
    let has_lua = game_has_lua_files(appid);
    
    // Get lua removal result
    let lua_result = remove_lua_files(appid);
    let manifest_result = remove_manifests(depot_ids);
    
    match (lua_result, manifest_result) {
        (Ok((lua_count, lua_found)), Ok(manifest_count)) => {
            // Build dynamic message
            let mut parts: Vec<String> = Vec::new();
            
            // Lua files message
            if lua_count > 0 {
                parts.push(format_file_count(lua_count, ".lua file", ".lua files"));
            } else if lua_found {
                // Files were found but couldn't be removed
                parts.push("0 .lua files".to_string());
            }
            
            // Manifest files message
            if manifest_count > 0 {
                parts.push(format_file_count(manifest_count, ".manifest file", ".manifest files"));
            }
            
            // Check if game wasn't in library
            if !has_lua && !lua_found && manifest_count == 0 {
                return Err("Cannot remove game that is not in your Steam library.".to_string());
            }
            
            // Combine messages
            if parts.is_empty() {
                Ok("No files found to remove".to_string())
            } else {
                Ok(format!("Removed {}", parts.join(" and ")))
            }
        }
        (Err(e), _) => Err(format!("Failed to remove Lua files: {}", e)),
        (_, Err(e)) => Err(format!("Failed to remove manifests: {}", e))
    }
}

// Get list of games with Lua files in stplug-in directory
#[tauri::command]
fn get_lua_games() -> Result<Vec<(u64, String)>, String> {
    let steam_path = get_steam_path()
        .ok_or("Could not find Steam installation")?;
    
    let stplug_path = steam_path.join("config").join("stplug-in");
    let mut games: Vec<(u64, String)> = Vec::new();
    
    if stplug_path.exists() {
        if let Ok(entries) = fs::read_dir(&stplug_path) {
            for entry in entries.flatten() {
                let entry_path = entry.path();
                let file_name = entry_path.file_name()
                    .and_then(|n| n.to_str())
                    .unwrap_or("");
                
                // Check if it's a lua file with appid in name
                if entry_path.extension().map_or(false, |ext| ext == "lua") {
                    // Extract appid from filename (usually format like "appid_xxxx.lua" or "xxxx.lua")
                    let appid_str: String = file_name.chars().take_while(|c| c.is_ascii_digit()).collect();
                    if let Ok(appid) = appid_str.parse::<u64>() {
                        if appid > 0 && !games.iter().any(|(id, _)| *id == appid) {
                            games.push((appid, file_name.to_string()));
                        }
                    }
                }
            }
        }
    }
    
    // Sort by appid
    games.sort_by(|a, b| a.0.cmp(&b.0));
    Ok(games)
}

// Check if Steam process is running using sysinfo (reliable, no console window)
#[tauri::command]
fn is_steam_running() -> bool {
    use sysinfo::{ProcessExt, System, SystemExt};
    
    let mut system = System::new_all();
    system.refresh_processes();
    
    for (_pid, process) in system.processes() {
        let name = process.name().to_lowercase();
        // Check for steam.exe specifically
        if name == "steam.exe" || name.contains("steam.exe") {
            return true;
        }
    }
    
    false
}

// Restart or Launch Steam
#[tauri::command]
fn restart_or_launch_steam() -> Result<String, String> {
    use std::process::Command;
    use std::os::windows::process::CommandExt;
    use sysinfo::{ProcessExt, System, SystemExt, Signal};
    
    const CREATE_NO_WINDOW: u32 = 0x08000000;
    
    let steam_path = get_steam_path()
        .ok_or("Could not find Steam installation")?;
    
    let steam_exe = steam_path.join("Steam.exe");
    
    if !steam_exe.exists() {
        return Err("Steam.exe not found".to_string());
    }
    
    let running = is_steam_running();
    
    if running {
        // Kill Steam and all related processes using sysinfo
        let mut system = System::new_all();
        system.refresh_processes();
        
        let steam_pids: Vec<_> = system.processes()
            .iter()
            .filter(|(_pid, process)| {
                let name = process.name().to_lowercase();
                name.contains("steam")
            })
            .map(|(pid, _process)| *pid)
            .collect();
        
        // Kill all Steam processes
        for pid in steam_pids {
            if let Some(process) = system.process(pid) {
                let _ = process.kill_with(Signal::Kill);
            }
        }
        
        // Also use taskkill as backup for any stubborn processes
        let _ = Command::new("cmd")
            .args(&["/C", "taskkill /F /IM steam.exe 2>nul"])
            .creation_flags(CREATE_NO_WINDOW)
            .output();
        
        // Wait 3 seconds for Steam to fully close
        std::thread::sleep(std::time::Duration::from_secs(3));
    }
    
    // Launch Steam directly without spawning cmd.exe
    // Use ShellExecute via cmd /c start but properly detached
    let steam_exe_str = steam_exe.to_str().unwrap_or("steam.exe");
    
    // Use std::process::Command with CREATE_NEW_PROCESS_GROUP to detach properly
    match Command::new("cmd")
        .args(&["/C", "start", "", steam_exe_str])
        .creation_flags(CREATE_NO_WINDOW | 0x00000200) // CREATE_NO_WINDOW | CREATE_NEW_PROCESS_GROUP
        .spawn() 
    {
        Ok(_) => {
            if running {
                Ok("Steam restarted successfully".to_string())
            } else {
                Ok("Steam launched successfully".to_string())
            }
        }
        Err(e) => Err(format!("Failed to launch Steam: {}", e))
    }
}

use tauri::Manager;

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![remove_lua_files, remove_manifests, remove_all, get_lua_games, is_steam_running, restart_or_launch_steam])
        .setup(|app| {
            // Set rounded window corners on Windows
            #[cfg(windows)]
            {
                use windows::Win32::Graphics::Dwm::{DwmSetWindowAttribute, DWMWINDOWATTRIBUTE};
                use windows::Win32::Foundation::HWND;
                
                let window = app.get_window("main").unwrap();
                let hwnd = window.hwnd().unwrap();
                
                // Enable rounded corners (Windows 11 style)
                let attribute = DWMWINDOWATTRIBUTE(33); // DWMWA_WINDOW_CORNER_PREFERENCE
                let preference: u32 = 2; // DWMWCP_ROUND
                
                unsafe {
                    let _ = DwmSetWindowAttribute(
                        HWND(hwnd.0),
                        attribute,
                        &preference as *const u32 as *const _,
                        std::mem::size_of::<u32>() as u32,
                    );
                }
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
