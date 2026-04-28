import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/tauri";

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
  appid: number;
  name: string;
}

function App() {
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SteamApp[]>([]);
  const [selectedApp, setSelectedApp] = useState<SteamApp | null>(null);
  const [depotData, setDepotData] = useState<DepotResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");

  // Search Steam API with autocomplete
  useEffect(() => {
    const searchSteam = async () => {
      if (searchQuery.length < 2) {
        setSearchResults([]);
        return;
      }

      setLoading(true);
      setError("");

      try {
        const response = await fetch(
          `https://steamcommunity.com/actions/SearchApps/${encodeURIComponent(searchQuery)}`
        );
        const data = await response.json();
        
        if (data && data.items) {
          setSearchResults(data.items.slice(0, 10));
        } else {
          setSearchResults([]);
        }
      } catch (err) {
        console.error("Search error:", err);
        setSearchResults([]);
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
      const response = await fetch(`https://manifest.steam.run/api/depot/${appid}`);
      if (!response.ok) {
        throw new Error("Failed to fetch depot data");
      }
      const data: DepotResponse = await response.json();
      setDepotData(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch depot data");
    } finally {
      setLoading(false);
    }
  };

  // Remove Lua files
  const removeLuaFiles = async () => {
    if (!selectedApp) return;

    setLoading(true);
    setStatus("Removing Lua files...");
    setError("");

    try {
      const result = await invoke<string>("remove_lua_files", { 
        appid: selectedApp.appid 
      });
      setStatus(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to remove Lua files");
    } finally {
      setLoading(false);
    }
  };

  // Remove manifests
  const removeManifests = async () => {
    if (!depotData) return;

    setLoading(true);
    setStatus("Removing manifests...");
    setError("");

    try {
      const depotIds = depotData.depots.map(d => d.depotid);
      const result = await invoke<string>("remove_manifests", { 
        depotIds 
      });
      setStatus(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to remove manifests");
    } finally {
      setLoading(false);
    }
  };

  // Remove all (Lua + manifests)
  const removeAll = async () => {
    if (!selectedApp || !depotData) return;

    setLoading(true);
    setStatus("Removing Lua files and manifests...");
    setError("");

    try {
      await removeLuaFiles();
      await removeManifests();
      setStatus("Successfully removed Lua files and manifests!");
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
    fetchDepotData(app.appid);
  };

  return (
    <div className="min-h-screen bg-[#05050e] text-white font-mono p-6 flex items-center justify-center">
      <div className="w-full max-w-2xl">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold mb-2">STRemover</h1>
          <p className="text-gray-400 text-sm">SteamTools Lua & Manifest Remover</p>
        </div>

        {/* Search Input */}
        <div className="mb-4">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search Steam app by name or AppID..."
            className="w-full bg-[#0a0a1a] border border-gray-700 rounded-lg px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-gray-500 transition-colors"
          />
        </div>

        {/* Search Results Dropdown */}
        {searchResults.length > 0 && (
          <div className="mb-4 bg-[#0a0a1a] border border-gray-700 rounded-lg overflow-hidden">
            {searchResults.map((app) => (
              <button
                key={app.appid}
                onClick={() => handleSelectApp(app)}
                className="w-full text-left px-4 py-3 hover:bg-[#15152a] transition-colors border-b border-gray-800 last:border-0"
              >
                <div className="font-bold">{app.name}</div>
                <div className="text-sm text-gray-500">AppID: {app.appid}</div>
              </button>
            ))}
          </div>
        )}

        {/* Selected App Info */}
        {selectedApp && (
          <div className="mb-6 bg-[#0a0a1a] border border-gray-700 rounded-lg p-4">
            <h2 className="font-bold text-lg mb-2">{selectedApp.name}</h2>
            <p className="text-gray-400 text-sm">AppID: {selectedApp.appid}</p>
          </div>
        )}

        {/* Depot Data */}
        {depotData && (
          <div className="mb-6 bg-[#0a0a1a] border border-gray-700 rounded-lg p-4">
            <h3 className="font-bold mb-3">Depot Information</h3>
            <div className="space-y-2">
              {depotData.depots.map((depot: Depot) => (
                <div key={depot.depotid} className="bg-[#15152a] rounded-lg p-3">
                  <div className="font-bold">Depot ID: {depot.depotid}</div>
                  <div className="text-sm text-gray-400">Manifest: {depot.manifestid}</div>
                  <div className="text-sm text-gray-400">Size: {(depot.size_bytes / 1024 / 1024).toFixed(2)} MB</div>
                  <div className="text-sm text-gray-400">Build ID: {depot.buildid}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Error Message */}
        {error && (
          <div className="mb-4 bg-red-900/20 border border-red-700 rounded-lg p-4 text-red-400">
            {error}
          </div>
        )}

        {/* Status Message */}
        {status && !error && (
          <div className="mb-4 bg-green-900/20 border border-green-700 rounded-lg p-4 text-green-400">
            {status}
          </div>
        )}

        {/* Action Buttons */}
        {selectedApp && depotData && (
          <div className="flex flex-col gap-3">
            <button
              onClick={removeLuaFiles}
              disabled={loading}
              className="w-full bg-[#1a1a2e] hover:bg-[#252540] border border-gray-600 rounded-lg px-6 py-3 font-bold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? "Processing..." : "Remove Lua Files"}
            </button>
            <button
              onClick={removeManifests}
              disabled={loading}
              className="w-full bg-[#1a1a2e] hover:bg-[#252540] border border-gray-600 rounded-lg px-6 py-3 font-bold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? "Processing..." : "Remove Manifests"}
            </button>
            <button
              onClick={removeAll}
              disabled={loading}
              className="w-full bg-white hover:bg-gray-200 text-black rounded-lg px-6 py-3 font-bold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? "Processing..." : "Remove All"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default App;
