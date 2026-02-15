"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { useRouter } from "next/navigation";

interface Category {
  category_id: string;
  category_name: string;
}

interface Stream {
  stream_id: number;
  name: string;
  category_id: string;
  stream_icon: string;
}

export default function EditorPage() {
  const router = useRouter();
  const [categories, setCategories] = useState<Category[]>([]);
  const [streams, setStreams] = useState<Stream[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [search, setSearch] = useState("");
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [m3uUrl, setM3uUrl] = useState<string | null>(null);
  const [shortCode, setShortCode] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [sessionToken, setSessionToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const storedToken = sessionStorage.getItem("iptv_session");

    if (!storedToken) {
      router.push("/");
      return;
    }

    setSessionToken(storedToken);

    // Fetch channel data from server-side session
    fetch(`/api/channels?token=${storedToken}`)
      .then((r) => {
        if (!r.ok) throw new Error("Session expired");
        return r.json();
      })
      .then((data) => {
        setCategories(data.categories || []);
        setStreams(data.streams || []);
        setLoading(false);
      })
      .catch(() => {
        sessionStorage.removeItem("iptv_session");
        router.push("/");
      });

    // Load existing selections if provider was saved before
    fetch(`/api/selections?token=${storedToken}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.streamIds) setSelected(new Set(d.streamIds));
        setToken(storedToken);
        setM3uUrl(`${window.location.origin}/api/m3u/${storedToken}`);
      })
      .catch(() => {});
  }, [router]);

  const filteredStreams = useMemo(() => {
    if (!search) return streams;
    const q = search.toLowerCase();
    return streams.filter((s) => s.name.toLowerCase().includes(q));
  }, [streams, search]);

  const streamsByCategory = useMemo(() => {
    const map = new Map<string, Stream[]>();
    for (const stream of filteredStreams) {
      const catId = stream.category_id || "uncategorized";
      if (!map.has(catId)) map.set(catId, []);
      map.get(catId)!.push(stream);
    }
    return map;
  }, [filteredStreams]);

  const categoryMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const cat of categories) {
      map.set(cat.category_id, cat.category_name);
    }
    map.set("uncategorized", "Uncategorized");
    return map;
  }, [categories]);

  const toggleStream = useCallback((streamId: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(streamId)) next.delete(streamId);
      else next.add(streamId);
      return next;
    });
  }, []);

  const toggleCategory = useCallback((categoryId: string) => {
    const catStreams = streamsByCategory.get(categoryId) || [];
    const allSelected = catStreams.every((s) => selected.has(s.stream_id));
    setSelected((prev) => {
      const next = new Set(prev);
      for (const s of catStreams) {
        if (allSelected) next.delete(s.stream_id);
        else next.add(s.stream_id);
      }
      return next;
    });
  }, [streamsByCategory, selected]);

  const toggleExpanded = useCallback((categoryId: string) => {
    setExpandedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(categoryId)) next.delete(categoryId);
      else next.add(categoryId);
      return next;
    });
  }, []);

  const selectAll = useCallback(() => {
    setSelected(new Set(streams.map((s) => s.stream_id)));
  }, [streams]);

  const deselectAll = useCallback(() => {
    setSelected(new Set());
  }, []);

  async function handleSave() {
    if (!sessionToken) return;
    setSaving(true);

    try {
      const res = await fetch("/api/selections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionToken,
          streamIds: Array.from(selected),
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      setToken(sessionToken);
      setShortCode(data.shortCode);
      const url = `${window.location.origin}/api/m3u/${sessionToken}`;
      setM3uUrl(url);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  function handleCopy(text: string, field: string) {
    navigator.clipboard.writeText(text);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 2000);
  }

  // Sort categories by name for display
  const sortedCategoryIds = useMemo(() => {
    return Array.from(streamsByCategory.keys()).sort((a, b) => {
      const nameA = categoryMap.get(a) || a;
      const nameB = categoryMap.get(b) || b;
      return nameA.localeCompare(nameB);
    });
  }, [streamsByCategory, categoryMap]);

  if (loading) {
    return (
      <main className="min-h-screen flex items-center justify-center">
        <p className="text-gray-400 text-lg">Loading channels...</p>
      </main>
    );
  }

  return (
    <main className="min-h-screen max-w-6xl mx-auto p-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold">Channel Editor</h1>
          <p className="text-gray-400 text-sm">
            {streams.length} channels in {categories.length} categories
            {selected.size > 0 && (
              <span className="text-blue-400 ml-2">({selected.size} selected)</span>
            )}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={selectAll}
            className="px-3 py-1.5 text-sm bg-gray-800 hover:bg-gray-700 rounded-lg transition-colors cursor-pointer"
          >
            Select All
          </button>
          <button
            onClick={deselectAll}
            className="px-3 py-1.5 text-sm bg-gray-800 hover:bg-gray-700 rounded-lg transition-colors cursor-pointer"
          >
            Deselect All
          </button>
          <button
            onClick={handleSave}
            disabled={saving || selected.size === 0}
            className="px-4 py-1.5 text-sm bg-blue-600 hover:bg-blue-700 disabled:bg-blue-800 disabled:text-gray-400 rounded-lg font-medium transition-colors cursor-pointer"
          >
            {saving ? "Saving..." : `Save (${selected.size})`}
          </button>
        </div>
      </div>

      {/* Connection Info */}
      {m3uUrl && shortCode && (
        <div className="mb-6 space-y-4">
          {/* Xtream Codes Login */}
          <div className="p-4 bg-green-900/30 border border-green-800 rounded-lg">
            <p className="text-green-400 text-sm font-medium mb-3">
              Xtream Codes Login (recommended for most IPTV clients):
            </p>
            <div className="grid grid-cols-[auto_1fr_auto] gap-2 items-center">
              <span className="text-gray-400 text-sm">URL:</span>
              <code className="px-3 py-1.5 bg-gray-800 border border-gray-700 rounded text-sm font-mono">
                {typeof window !== "undefined" ? window.location.origin : ""}
              </code>
              <button
                onClick={() => handleCopy(typeof window !== "undefined" ? window.location.origin : "", "url")}
                className="px-3 py-1.5 bg-green-700 hover:bg-green-600 rounded text-xs font-medium transition-colors cursor-pointer"
              >
                {copiedField === "url" ? "Copied!" : "Copy"}
              </button>

              <span className="text-gray-400 text-sm">Username:</span>
              <code className="px-3 py-1.5 bg-gray-800 border border-gray-700 rounded text-sm font-mono">
                {shortCode}
              </code>
              <button
                onClick={() => handleCopy(shortCode, "user")}
                className="px-3 py-1.5 bg-green-700 hover:bg-green-600 rounded text-xs font-medium transition-colors cursor-pointer"
              >
                {copiedField === "user" ? "Copied!" : "Copy"}
              </button>

              <span className="text-gray-400 text-sm">Password:</span>
              <code className="px-3 py-1.5 bg-gray-800 border border-gray-700 rounded text-sm font-mono">
                1234
              </code>
              <button
                onClick={() => handleCopy("1234", "pass")}
                className="px-3 py-1.5 bg-green-700 hover:bg-green-600 rounded text-xs font-medium transition-colors cursor-pointer"
              >
                {copiedField === "pass" ? "Copied!" : "Copy"}
              </button>
            </div>
          </div>

          {/* M3U URL fallback */}
          <div className="p-4 bg-gray-900 border border-gray-800 rounded-lg">
            <p className="text-gray-400 text-sm font-medium mb-2">
              Or use M3U playlist URL directly:
            </p>
            <div className="flex gap-2">
              <input
                type="text"
                readOnly
                value={m3uUrl}
                className="flex-1 px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm font-mono"
              />
              <button
                onClick={() => handleCopy(m3uUrl, "m3u")}
                className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg text-sm font-medium transition-colors cursor-pointer"
              >
                {copiedField === "m3u" ? "Copied!" : "Copy"}
              </button>
            </div>
          </div>

          <p className="text-gray-500 text-xs">
            {selected.size} channels selected. Video streams go directly to your provider, not through this app.
          </p>
        </div>
      )}

      {/* Search */}
      <div className="mb-4">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search channels..."
          className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        />
      </div>

      {/* Channel List */}
      <div className="space-y-2">
        {sortedCategoryIds.map((catId) => {
          const catStreams = streamsByCategory.get(catId) || [];
          const catName = categoryMap.get(catId) || catId;
          const selectedInCat = catStreams.filter((s) => selected.has(s.stream_id)).length;
          const allSelected = selectedInCat === catStreams.length;
          const someSelected = selectedInCat > 0 && !allSelected;
          const isExpanded = expandedCategories.has(catId);

          return (
            <div key={catId} className="bg-gray-900 rounded-lg border border-gray-800">
              {/* Category Header */}
              <div className="flex items-center gap-3 px-4 py-3">
                <input
                  type="checkbox"
                  checked={allSelected}
                  ref={(el) => {
                    if (el) el.indeterminate = someSelected;
                  }}
                  onChange={() => toggleCategory(catId)}
                  className="w-4 h-4 accent-blue-500 cursor-pointer"
                />
                <button
                  onClick={() => toggleExpanded(catId)}
                  className="flex-1 flex items-center justify-between text-left cursor-pointer"
                >
                  <span className="font-medium">{catName}</span>
                  <span className="text-gray-400 text-sm">
                    {selectedInCat}/{catStreams.length}
                    <span className="ml-2">{isExpanded ? "\u25B2" : "\u25BC"}</span>
                  </span>
                </button>
              </div>

              {/* Channel List */}
              {isExpanded && (
                <div className="border-t border-gray-800 max-h-96 overflow-y-auto">
                  {catStreams.map((stream) => (
                    <label
                      key={stream.stream_id}
                      className="flex items-center gap-3 px-4 py-2 hover:bg-gray-800/50 cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={selected.has(stream.stream_id)}
                        onChange={() => toggleStream(stream.stream_id)}
                        className="w-4 h-4 accent-blue-500 cursor-pointer"
                      />
                      {stream.stream_icon && (
                        <img
                          src={stream.stream_icon}
                          alt=""
                          className="w-6 h-6 object-contain rounded"
                          onError={(e) => {
                            (e.target as HTMLImageElement).style.display = "none";
                          }}
                        />
                      )}
                      <span className="text-sm">{stream.name}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {filteredStreams.length === 0 && (
        <p className="text-gray-400 text-center py-8">
          {search ? "No channels match your search." : "No channels loaded."}
        </p>
      )}
    </main>
  );
}
