"use client";

import { useState, useRef } from "react";
import { displayName, truncateName } from "@/lib/utils";
import Avatar from "@/components/Avatar";

interface SearchResult {
  id: string;
  content: string;
  createdAt: string;
  author: { id: string; username: string; avatar?: string | null };
  channel: { id: string; name: string };
}

interface SearchPanelProps {
  serverId: string;
  onClose: () => void;
  onJumpToMessage?: (channelId: string, messageId: string) => void;
}

export default function SearchPanel({ serverId, onClose, onJumpToMessage }: SearchPanelProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [filterUser, setFilterUser] = useState("");
  const [filterDateFrom, setFilterDateFrom] = useState("");
  const [filterDateTo, setFilterDateTo] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function handleSearch(value: string) {
    setQuery(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (!value.trim()) {
      setResults([]);
      setSearched(false);
      return;
    }

    debounceRef.current = setTimeout(async () => {
      setSearching(true);
      try {
        let url = `/api/messages/search?q=${encodeURIComponent(value.trim())}&serverId=${serverId}`;
        if (filterUser.trim()) url += `&user=${encodeURIComponent(filterUser.trim())}`;
        if (filterDateFrom) url += `&from=${filterDateFrom}`;
        if (filterDateTo) url += `&to=${filterDateTo}`;
        const res = await fetch(url);
        if (res.ok) {
          const data = await res.json();
          setResults(data.results || []);
        }
      } catch { /* ignore */ }
      setSearching(false);
      setSearched(true);
    }, 300);
  }

  function clearFilters() {
    setFilterUser("");
    setFilterDateFrom("");
    setFilterDateTo("");
    if (query) handleSearch(query);
  }

  return (
    <div className="w-80 bg-[var(--panel)] flex flex-col border-l border-[var(--accent-2)]/30 shrink-0">
      <div className="h-12 px-3 flex items-center gap-2 border-b border-[var(--accent-2)]/30">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-[var(--muted)] shrink-0">
          <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        <input
          type="text"
          value={query}
          onChange={(e) => handleSearch(e.target.value)}
          placeholder="Search messages..."
          className="flex-1 bg-transparent text-sm text-[var(--text)] focus:outline-none placeholder:text-[var(--muted)]"
          autoFocus
        />
        <button
          onClick={() => setShowFilters((v) => !v)}
          className={`text-xs transition-colors ${showFilters ? "text-[var(--accent-2)]" : "text-[var(--muted)] hover:text-[var(--text)]"}`}
          title="Search filters"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
          </svg>
        </button>
        <button
          onClick={onClose}
          className="text-[var(--muted)] hover:text-[var(--text)] text-lg leading-none"
        >
          x
        </button>
      </div>

      {/* Filters */}
      {showFilters && (
        <div className="px-3 py-2 border-b border-[var(--accent-2)]/20 space-y-2 bg-[var(--panel-2)]">
          <div>
            <label className="text-[10px] text-[var(--muted)] uppercase block mb-0.5">By User</label>
            <input
              type="text"
              value={filterUser}
              onChange={(e) => setFilterUser(e.target.value)}
              placeholder="Username..."
              className="w-full px-2 py-1 text-xs bg-[var(--panel)] text-[var(--text)] border border-[var(--accent-2)]/30 rounded focus:outline-none"
            />
          </div>
          <div className="flex gap-2">
            <div className="flex-1">
              <label className="text-[10px] text-[var(--muted)] uppercase block mb-0.5">From</label>
              <input
                type="date"
                value={filterDateFrom}
                onChange={(e) => setFilterDateFrom(e.target.value)}
                className="w-full px-2 py-1 text-xs bg-[var(--panel)] text-[var(--text)] border border-[var(--accent-2)]/30 rounded focus:outline-none"
              />
            </div>
            <div className="flex-1">
              <label className="text-[10px] text-[var(--muted)] uppercase block mb-0.5">To</label>
              <input
                type="date"
                value={filterDateTo}
                onChange={(e) => setFilterDateTo(e.target.value)}
                className="w-full px-2 py-1 text-xs bg-[var(--panel)] text-[var(--text)] border border-[var(--accent-2)]/30 rounded focus:outline-none"
              />
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => query && handleSearch(query)}
              className="flex-1 py-1 text-xs bg-[var(--accent-2)] text-[var(--text)] rounded hover:bg-[var(--accent)] transition-colors"
            >
              Apply
            </button>
            <button
              onClick={clearFilters}
              className="flex-1 py-1 text-xs bg-[var(--panel)] text-[var(--muted)] rounded hover:text-[var(--text)] transition-colors"
            >
              Clear
            </button>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        {searching && (
          <div className="px-4 py-8 text-center text-sm text-[var(--muted)]">Searching...</div>
        )}

        {!searching && searched && results.length === 0 && (
          <div className="px-4 py-8 text-center text-sm text-[var(--muted)]">
            No results found for &ldquo;{query}&rdquo;
          </div>
        )}

        {!searching && results.map((r) => (
          <button
            key={r.id}
            onClick={() => onJumpToMessage?.(r.channel.id, r.id)}
            className="w-full text-left px-3 py-2.5 border-b border-[var(--accent-2)]/10 hover:bg-[var(--panel-2)]/50 transition-colors"
          >
            <div className="flex items-center gap-2 mb-1">
              <Avatar username={r.author.username} avatarUrl={r.author.avatar} size={20} className="bg-[var(--accent-2)] text-[var(--text)]" />
              <span className="text-xs font-semibold text-[var(--text)]">{truncateName(r.author.username)}</span>
              <span className="text-xs text-[var(--muted)]">in #{r.channel.name}</span>
              <span className="text-xs text-[var(--muted)] ml-auto">
                {new Date(r.createdAt).toLocaleDateString()}
              </span>
            </div>
            <p className="text-sm text-[var(--muted)] truncate">{r.content}</p>
          </button>
        ))}

        {!searching && !searched && (
          <div className="px-4 py-8 text-center text-sm text-[var(--muted)]">
            Search messages in this server
          </div>
        )}
      </div>
    </div>
  );
}
