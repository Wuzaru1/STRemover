import { useState, useEffect, memo } from "react";
import { invoke } from "@tauri-apps/api/tauri";
import { appWindow } from "@tauri-apps/api/window";
import { fetch } from '@tauri-apps/api/http';
import fuzzysort from 'fuzzysort';

// Memoized game card to prevent re-renders
const GameCard = memo(({ game, onClick }: { game: LuaGame; onClick: () => void }) => (
  <button
    onClick={onClick}
    className="bg-[#0a0a1a] border border-gray-700 rounded-xl p-2 hover:bg-[#15152a] transition-colors text-left contain-layout"
  >
    {game.appInfo ? (
      <>
        <img
          src={game.appInfo.tiny_image}
          alt={game.appInfo.name}
          loading="lazy"
          className="w-full h-12 object-cover rounded-lg mb-1"
          onError={(e) => {
            (e.currentTarget as HTMLImageElement).src = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='80' height='48'%3E%3Crect width='80' height='48' fill='%231a1a2e'/%3E%3C/svg%3E";
          }}
        />
        <div className="text-[10px] font-bold truncate">{game.appInfo.name}</div>
      </>
    ) : (
      <div className="flex items-center justify-center h-16">
        <span className="text-[10px] text-gray-500">AppID: {game.appid}</span>
      </div>
    )}
  </button>
));

interface Depot {
  depotid: number;
  manifestid: string;
  size_bytes: number;
  buildid: number;
  timeupdated: number;
}

interface DepotResponse {
  appid: number;
  depots: Depot[];
}

interface SteamApp {
  id: number;
  name: string;
  tiny_image: string;
}

type View = 'home' | 'search' | 'detail';

interface LuaGame {
  appid: number;
  filename: string;
  appInfo?: SteamApp;
}

function App() {
  const [currentView, setCurrentView] = useState<View>('home');
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SteamApp[]>([]);
  const [selectedApp, setSelectedApp] = useState<SteamApp | null>(null);
  const [depotData, setDepotData] = useState<DepotResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [showDropdown, setShowDropdown] = useState(false);
  const [luaGames, setLuaGames] = useState<LuaGame[]>([]);
  const [contextMenu, setContextMenu] = useState<{x: number, y: number, show: boolean}>({x: 0, y: 0, show: false});
  const [steamRunning, setSteamRunning] = useState<boolean>(false);
  const [, setAppCache] = useState<Record<number, SteamApp>>({});
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [loadingProgress, setLoadingProgress] = useState<number>(0);

  // Initial load with cache - run once
  useEffect(() => {
    const initLoad = async () => {
      setIsLoading(true);
      
      // Load cached data from localStorage
      const cached = localStorage.getItem('steamAppCache');
      let cacheData: Record<number, SteamApp> = {};
      if (cached) {
        try {
          cacheData = JSON.parse(cached);
          setAppCache(cacheData);
        } catch {
          // Invalid cache, ignore
        }
      }
      
      // Get list of games from disk
      try {
        const games = await invoke<[number, string][]>('get_lua_games');
        const luaGamesList: LuaGame[] = games.map(([appid, filename]) => ({ 
          appid, 
          filename,
          appInfo: cacheData[appid]
        }));
        setLuaGames(luaGamesList);
        setLoadingProgress(50);
        
        // Show UI immediately with cache
        setIsLoading(false);
        
        // Refresh data in background - fetch 5 at a time for speed
        const gamesToFetch = luaGamesList.filter(g => !cacheData[g.appid]);
        const newCache = { ...cacheData };
        const batchSize = 5;
        
        for (let i = 0; i < gamesToFetch.length; i += batchSize) {
          const batch = gamesToFetch.slice(i, i + batchSize);
          
          // Fetch batch concurrently
          const results = await Promise.all(
            batch.map(async (game) => {
              try {
                const response = await fetch(
                  `https://store.steampowered.com/api/storesearch/?term=${game.appid}&l=english&cc=CA`,
                  { method: 'GET', timeout: 30 }
                );
                const data = response.data as any;
                if (data?.items) {
                  const exactMatch = data.items.find((item: any) => item.id === game.appid);
                  if (exactMatch) {
                    return {
                      appid: game.appid,
                      appInfo: {
                        id: exactMatch.id,
                        name: exactMatch.name,
                        tiny_image: exactMatch.tiny_image
                      }
                    };
                  }
                }
              } catch {
                // Silently fail
              }
              return null;
            })
          );
          
          // Apply batch results
          results.forEach(result => {
            if (result) {
              const game = luaGamesList.find(g => g.appid === result.appid);
              if (game) {
                game.appInfo = result.appInfo;
                newCache[result.appid] = result.appInfo;
              }
            }
          });
          
          // Update UI after each batch
          setLuaGames([...luaGamesList]);
          
          // Update progress
          if (isLoading) {
            setLoadingProgress(50 + Math.floor((i / gamesToFetch.length) * 50));
          }
        }
        
        // Save cache
        setAppCache(newCache);
        localStorage.setItem('steamAppCache', JSON.stringify(newCache));
      } catch {
        setIsLoading(false);
      }
    };
    
    initLoad();
    
    // Check Steam status periodically
    const interval = setInterval(checkSteamStatus, 5000);
    return () => clearInterval(interval);
  }, []);

  const checkSteamStatus = async () => {
    try {
      const running = await invoke<boolean>('is_steam_running');
      setSteamRunning(running);
    } catch (e) {
      // Silently fail
    }
  };

  const handleSteamRestart = async () => {
    try {
      const result = await invoke<string>('restart_or_launch_steam');
      setStatus(result);
      // Check status multiple times after restart
      setTimeout(checkSteamStatus, 2000);
      setTimeout(checkSteamStatus, 4000);
      setTimeout(checkSteamStatus, 6000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to restart Steam');
    }
  };

  // loadLuaGames removed - now inline in initLoad

  // Search Steam API with autocomplete
  useEffect(() => {
    const searchSteam = async () => {
      if (searchQuery.length < 2) {
        setSearchResults([]);
        setShowDropdown(false);
        return;
      }

      setLoading(true);
      setError("");

      try {
        // Check if it's an AppID search (numbers only)
        const isAppId = /^\d+$/.test(searchQuery.trim());
        
        // Use Tauri HTTP client to bypass CORS
        const response = await fetch(
          `https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(searchQuery)}&l=english&cc=CA`,
          {
            method: 'GET',
            timeout: 30
          }
        );
        
        const data = response.data as any;
        
        if (data && data.items && Array.isArray(data.items) && data.items.length > 0) {
          // If searching by AppID, find exact match
          if (isAppId) {
            const searchId = parseInt(searchQuery.trim());
            const exactMatch = data.items.find((item: any) => item.id === searchId);
            if (exactMatch) {
              const app: SteamApp = {
                id: exactMatch.id,
                name: exactMatch.name,
                tiny_image: exactMatch.tiny_image
              };
              setSearchResults([app]);
              setShowDropdown(true);
            } else {
              setSearchResults([]);
              setShowDropdown(false);
            }
          } else {
            const apps: SteamApp[] = data.items.map((item: any) => ({
              id: item.id,
              name: item.name,
              tiny_image: item.tiny_image
            }));
            
            // Use fuzzysort to filter and rank results
            const results = fuzzysort.go(searchQuery, apps, { key: 'name', limit: 6 });
            const sortedApps = results.map((r: any) => r.obj);
            
            setSearchResults(sortedApps);
            setShowDropdown(true);
          }
        } else {
          setSearchResults([]);
          setShowDropdown(false);
        }
      } catch (err) {
        setError(`Search failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
        setSearchResults([]);
        setShowDropdown(false);
      } finally {
        setLoading(false);
      }
    };

    const debounceTimer = setTimeout(searchSteam, 300);
    return () => clearTimeout(debounceTimer);
  }, [searchQuery]);


  // Fetch depot data when app is selected
  const fetchDepotData = async (appid: number) => {
    setLoading(true);
    setError("");
    setDepotData(null);
    setStatus("");

    try {
      const response = await fetch(`https://manifest.steam.run/api/depot/${appid}`, { method: 'GET', timeout: 30 });
      const data = response.data as DepotResponse;
      setDepotData(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch depot data");
    } finally {
      setLoading(false);
    }
  };

  // Remove both Lua files and manifests
  const handleRemove = async () => {
    if (!selectedApp || !depotData) return;

    setLoading(true);
    setStatus("Removing files...");
    setError("");

    try {
      const depotIds = depotData.depots.map(d => d.depotid);
      const result = await invoke<string>("remove_all", { 
        appid: selectedApp.id,
        depotIds 
      });
      setStatus(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to remove files");
    } finally {
      setLoading(false);
    }
  };

  const handleSelectApp = (app: SteamApp) => {
    setSelectedApp(app);
    setSearchQuery(app.name);
    setSearchResults([]);
    setShowDropdown(false);
    setCurrentView('detail');
    setDepotData(null);
    setStatus("Loading depot data...");
    setError("");
    // Defer fetch to allow UI to render first
    setTimeout(() => fetchDepotData(app.id), 50);
  };

  const goHome = () => {
    setCurrentView('home');
    setSelectedApp(null);
    setDepotData(null);
    setSearchQuery("");
    setSearchResults([]);
    setStatus("");
    setError("");
  };

  const goToSearch = () => {
    setCurrentView('search');
    setSelectedApp(null);
    setDepotData(null);
    setSearchQuery("");
    setSearchResults([]);
    setStatus("");
    setError("");
  };

  const handleMinimize = () => appWindow.minimize();
  const handleMaximize = () => appWindow.toggleMaximize();
  const handleClose = () => appWindow.close();

  // Custom context menu for copy/paste
  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    const target = e.target as HTMLElement;
    const isInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA';
    if (isInput) {
      setContextMenu({ x: e.clientX, y: e.clientY, show: true });
    }
  };

  const handleCopy = () => {
    document.execCommand('copy');
    setContextMenu({ ...contextMenu, show: false });
  };

  const handlePaste = () => {
    document.execCommand('paste');
    setContextMenu({ ...contextMenu, show: false });
  };

  // Click outside to close context menu
  useEffect(() => {
    const handleClick = () => setContextMenu({ ...contextMenu, show: false });
    if (contextMenu.show) {
      window.addEventListener('click', handleClick);
      return () => window.removeEventListener('click', handleClick);
    }
  }, [contextMenu.show]);

  return (
    <div 
      className="h-screen bg-[#05050e] text-white font-mono flex flex-col select-none overflow-hidden"
      onContextMenu={handleContextMenu}
    >
      {/* Custom Context Menu */}
      {contextMenu.show && (
        <div 
          className="absolute z-50 bg-[#0a0a1a] border border-gray-700 rounded-lg py-1 shadow-lg"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          <button onClick={handleCopy} className="w-full px-4 py-1 text-xs text-left hover:bg-[#1a1a2e]">Copy</button>
          <button onClick={handlePaste} className="w-full px-4 py-1 text-xs text-left hover:bg-[#1a1a2e]">Paste</button>
        </div>
      )}
      {/* Loading Screen */}
      {isLoading && (
        <div className="absolute inset-0 bg-[#05050e] z-50 flex flex-col items-center justify-center">
          <div className="text-lg font-bold mb-4">Loading STRemover...</div>
          <div className="w-64 h-2 bg-[#1a1a2e] rounded-full overflow-hidden">
            <div 
              className="h-full bg-white transition-all duration-300 ease-out"
              style={{ width: `${loadingProgress}%` }}
            />
          </div>
          <div className="text-xs text-gray-500 mt-2">{Math.round(loadingProgress)}%</div>
        </div>
      )}

      {/* Custom Titlebar */}
      <div className="h-8 bg-[#0a0a1a] flex items-center justify-between px-2 border-b border-gray-800 rounded-t-lg" data-tauri-drag-region>
        <div className="flex items-center gap-2">
          <button 
            onClick={goHome}
            className="text-xs font-bold ml-1 hover:text-gray-300 transition-colors cursor-pointer"
          >
            STRemover
          </button>
          {currentView !== 'home' && (
            <button 
              onClick={goHome}
              className="text-[10px] bg-[#1a1a2e] hover:bg-[#252540] px-2 py-1 rounded transition-colors text-gray-300"
            >
              ← Back
            </button>
          )}
          <button
            onClick={handleSteamRestart}
            className="text-[10px] bg-[#1a1a2e] hover:bg-[#252540] px-2 py-1 rounded transition-colors text-gray-300"
            title={steamRunning ? "Restart Steam" : "Launch Steam"}
          >
            {steamRunning ? "Restart Steam" : "Launch Steam"}
          </button>
        </div>
        <div className="flex items-center">
          <button onClick={handleMinimize} className="w-8 h-8 flex items-center justify-center hover:bg-[#1a1a2e] text-xs rounded-tl-lg">─</button>
          <button onClick={handleMaximize} className="w-8 h-8 flex items-center justify-center hover:bg-[#1a1a2e] text-xs">□</button>
          <button onClick={handleClose} className="w-8 h-8 flex items-center justify-center hover:bg-red-600 text-xs rounded-tr-lg">×</button>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 p-3 flex flex-col gap-2 overflow-auto rounded-b-lg bg-[#05050e] pb-4">
        {currentView === 'home' && (
          <>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-bold">Your Current SteamTools Games</span>
              <button 
                onClick={goToSearch}
                className="text-[10px] bg-[#1a1a2e] hover:bg-[#252540] px-2 py-1 rounded transition-colors"
              >
                + Search
              </button>
            </div>
            
            {luaGames.length === 0 ? (
              <div className="text-center text-gray-500 text-xs py-8">
                No Lua files found in Steam/config/stplug-in
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-2 overflow-y-auto contain-layout">
                {luaGames.map((game) => (
                  <GameCard
                    key={game.appid}
                    game={game}
                    onClick={() => {
                      if (game.appInfo) {
                        handleSelectApp(game.appInfo);
                      } else {
                        setSearchQuery(game.appid.toString());
                      }
                    }}
                  />
                ))}
              </div>
            )}
          </>
        )}

        {currentView === 'search' && (
          <>
            {/* Search Input */}
            <div className="relative">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onFocus={() => searchResults.length > 0 && setShowDropdown(true)}
                onBlur={() => setTimeout(() => setShowDropdown(false), 200)}
                placeholder="Search by name or AppID..."
                className="w-full bg-[#0a0a1a] border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-gray-500"
              />

              {/* Autocomplete Dropdown */}
              {showDropdown && searchResults.length > 0 && (
                <div className="absolute top-full left-0 right-0 mt-1 bg-[#0a0a1a] border border-gray-700 rounded-lg overflow-hidden z-50 max-h-48 overflow-y-auto shadow-lg">
                  {searchResults.map((app) => (
                    <button
                      key={app.id}
                      onClick={() => handleSelectApp(app)}
                      className="w-full text-left px-3 py-2 hover:bg-[#15152a] flex items-center gap-3 border-b border-gray-800 last:border-0 transition-colors"
                    >
                      <img
                        src={app.tiny_image}
                        alt={app.name}
                        className="w-12 h-6 object-cover rounded bg-[#1a1a2e]"
                        onError={(e) => {
                          (e.currentTarget as HTMLImageElement).src = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='48' height='24'%3E%3Crect width='48' height='24' fill='%231a1a2e'/%3E%3C/svg%3E";
                        }}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-bold truncate">{app.name}</div>
                        <div className="text-[10px] text-gray-500">{app.id}</div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
              {loading && searchQuery.length >= 2 && (
                <div className="absolute top-full left-0 right-0 mt-1 bg-[#0a0a1a] border border-gray-700 rounded-lg p-3 text-xs text-gray-400 text-center">
                  Searching...
                </div>
              )}
            </div>
          </>
        )}

        {currentView === 'detail' && selectedApp && (
          <>
            {/* Selected App Info - Compact */}
            <div className="bg-[#0a0a1a] border border-gray-700 rounded-lg p-2">
              <div className="flex items-center gap-3">
                <img
                  src={selectedApp.tiny_image}
                  alt={selectedApp.name}
                  className="w-20 h-8 object-cover rounded"
                  onError={(e) => {
                    e.currentTarget.src = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='80' height='32'%3E%3Crect width='80' height='32' fill='%231a1a2e'/%3E%3C/svg%3E";
                  }}
                />
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-bold truncate">{selectedApp.name}</div>
                  <div className="text-[10px] text-gray-500">{selectedApp.id}</div>
                </div>
              </div>
            </div>

            {/* Depot Data */}
            {depotData && (
              <div className="bg-[#0a0a1a] border border-gray-700 rounded-lg p-2 flex-1 overflow-auto min-h-0">
                <div className="text-xs font-bold mb-2">Depot Information</div>
                <div className="space-y-1">
                  {depotData.depots.map((depot: Depot) => (
                    <div key={depot.depotid} className="bg-[#15152a] rounded-lg p-2 text-[10px]">
                      <div className="font-bold">Depot ID: {depot.depotid}</div>
                      <div className="text-gray-400 truncate">Manifest: {depot.manifestid}</div>
                      <div className="text-gray-400">Size: {(depot.size_bytes / 1024 / 1024).toFixed(2)} MB</div>
                      <div className="text-gray-400">Build ID: {depot.buildid}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Error Message */}
            {error && (
              <div className="bg-red-900/20 border border-red-700 rounded-lg px-3 py-2 text-red-400 text-xs">
                {error}
              </div>
            )}

            {/* Status Message */}
            {status && !error && (
              <div className="bg-green-900/20 border border-green-700 rounded-lg px-3 py-2 text-green-400 text-xs">
                {status}
              </div>
            )}

            {/* Single Remove Button */}
            {selectedApp && depotData && (
              <button
                onClick={handleRemove}
                disabled={loading}
                className="bg-white hover:bg-gray-200 text-black rounded-lg px-4 py-3 text-sm font-bold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? "Removing..." : "Remove Files"}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default App;
