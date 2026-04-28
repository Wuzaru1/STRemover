#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::fs;
use std::path::PathBuf;

#[tauri::command]
fn remove_lua_files(appid: u64) -> Result<String, String> {
    // Try common Steam installation paths
    let steam_paths = vec![
        format!("C:/Program Files (x86)/Steam/steamapps/workshop/content/{}", appid),
        format!("C:/Program Files/Steam/steamapps/workshop/content/{}", appid),
        format!("D:/Steam/steamapps/workshop/content/{}", appid),
        format!("E:/Steam/steamapps/workshop/content/{}", appid),
    ];

    let mut removed_count = 0;
    let mut found_path = false;

    for path_str in steam_paths {
        let path = PathBuf::from(&path_str);
        if path.exists() {
            found_path = true;
            // Remove all .lua files in the directory and subdirectories
            if let Ok(entries) = fs::read_dir(&path) {
                for entry in entries.flatten() {
                    let entry_path = entry.path();
                    if entry_path.is_dir() {
                        // Recursively remove lua files in subdirectories
                        if let Ok(sub_entries) = fs::read_dir(&entry_path) {
                            for sub_entry in sub_entries.flatten() {
                                let sub_path = sub_entry.path();
                                if sub_path.extension().map_or(false, |ext| ext == "lua") {
                                    if fs::remove_file(&sub_path).is_ok() {
                                        removed_count += 1;
                                    }
                                }
                            }
                        }
                    } else if entry_path.extension().map_or(false, |ext| ext == "lua") {
                        if fs::remove_file(&entry_path).is_ok() {
                            removed_count += 1;
                        }
                    }
                }
            }
        }
    }

    if found_path {
        Ok(format!("Removed {} Lua files for AppID {}", removed_count, appid))
    } else {
        Err(format!("Could not find workshop directory for AppID {}. Please verify Steam installation path.", appid))
    }
}

#[tauri::command]
fn remove_manifests(depot_ids: Vec<u64>) -> Result<String, String> {
    // Try common Steam depotcache paths
    let depotcache_paths = vec![
        "C:/Program Files (x86)/Steam/appcache/depotcache".to_string(),
        "C:/Program Files/Steam/appcache/depotcache".to_string(),
        "D:/Steam/appcache/depotcache".to_string(),
        "E:/Steam/appcache/depotcache".to_string(),
    ];

    let mut removed_count = 0;
    let mut found_path = false;

    for cache_path_str in depotcache_paths {
        let cache_path = PathBuf::from(&cache_path_str);
        if cache_path.exists() {
            found_path = true;
            if let Ok(entries) = fs::read_dir(&cache_path) {
                for entry in entries.flatten() {
                    let entry_path = entry.path();
                    let file_name = entry_path.file_name()
                        .and_then(|n| n.to_str())
                        .unwrap_or("");

                    // Check if the file matches any of the depot IDs
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
    }

    if found_path {
        Ok(format!("Removed {} manifest cache files", removed_count))
    } else {
        Err("Could not find Steam depotcache directory. Please verify Steam installation path.".to_string())
    }
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![remove_lua_files, remove_manifests])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
