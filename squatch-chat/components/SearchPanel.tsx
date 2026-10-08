"use client";

import { useState, useRef } from "react";
import { truncateName } from "@/lib/utils";
import Avatar from "@/components/Avatar";
import BlockedMessageGate from "@/components/BlockedMessageGate";

interface SearchResult {
  id: string;
  content: string;
  createdAt: string;
  author: { id: string; username: string; avatar?: string | null };
  channel: { id: string; name: string };
}

interface Filters {
  user: string;
  from: string;
  to: string;
}

interface SearchPanelProps {
  serverId: string;
  onClose: () => void;
  onJumpToMessage?: (channelId: string, messageId: string) => void;
  blockedUserIds?: ReadonlySet<string>;
}

export default function SearchPanel({ serverId, onClose, onJumpToMessage, blockedUserIds }: SearchPanelProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [filterUser, setFilterUser] = useState("");
  const [filterDateFrom, setFilterDateFrom] = useState("");
  const [filterDateTo, setFilterDateTo] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [error, setError] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestIdRef = useRef(0);

  const currentFilters = (): Filters => ({ user: filterUser, from: filterDateFrom, to: filterDateTo });
  const hasFilters = Boolean(filterUser.trim() || filterDateFrom || filterDateTo);

  // Filters are passed in explicitly so Clear/Apply never search with a
  // stale closure of the previous filter values.
  function runSearch(value: string, filters: Filters, delayMs = 300) {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (!value.trim()) {
      requestIdRef.current += 1; // drop any in-flight response
      setResults([]);
      setSearched(false);
      setSearching(false);
      return;
    }

    debounceRef.current = setTimeout(async () => {
      const requestId = ++requestIdRef.current;
      setSearching(true);
      setError(false);
      try {
        const params = new URLSearchParams({ q: value.trim(), serverId });
        if (filters.user.trim()) params.set("user", filters.user.trim());
        if (filters.from) params.set("from", filters.from);
        if (filters.to) params.set("to", filters.to);
        if (filters.from || filters.to) params.set("tz", String(new Date().getTimezoneOffset()));
        const res = await fetch(`/api/messages/search?${params.toString()}`);
        if (requestId !== requestIdRef.current) return;
        if (res.ok) {
          const data = await res.json();
          if (requestId !== requestIdRef.current) return;
          setResults(data.results || []);
        } else {
          setResults([]);
          setError(true);
        }
      } catch {
        if (requestId !== requestIdRef.current) return;
        setResults([]);
        setError(true);
      }
      setSearching(false);
      setSearched(true);
    }, delayMs);
  }

  function handleSearch(value: string) {
    setQuery(value);
    runSearch(value, currentFilters());
  }

  function applyFilters() {
    runSearch(query, currentFilters(), 0);
  }

  function clearFilters() {
    setFilterUser("");
    setFilterDateFrom("");
    setFilterDateTo("");
    runSearch(query, { user: "", from: "", to: "" }, 0);
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
          aria-label="Search messages"
          className="flex-1 bg-transparent text-sm text-[var(--text)] focus:outline-none placeholder:text-[var(--muted)]"
          autoFocus
        />
        <button
          onClick={() => setShowFilters((v) => !v)}
          className={`relative text-xs transition-colors ${showFilters || hasFilters ? "text-[var(--accent)]" : "text-[var(--muted)] hover:text-[var(--text)]"}`}
          title="Search filters"
          aria-label="Search filters"
          aria-expanded={showFilters}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
          </svg>
        </button>
        <button
          onClick={onClose}
          aria-label="Close search"
          title="Close search"
          className="text-[var(--muted)] hover:text-[var(--text)] text-lg leading-none"
        >
          &times;
        </button>
      </div>

      {/* Filters */}
      {showFilters && (
        <div className="px-3 py-2 border-b border-[var(--accent-2)]/20 space-y-2 bg-[var(--panel-2)]">
          <div>
            <label htmlFor="search-filter-user" className="text-[10px] text-[var(--muted)] uppercase block mb-0.5">By User</label>
            <input
              id="search-filter-user"
              type="text"
              value={filterUser}
              onChange={(e) => setFilterUser(e.target.value)}
              placeholder="Username..."
              className="w-full px-2 py-1 text-xs bg-[var(--panel)] text-[var(--text)] border border-[var(--accent-2)]/30 rounded focus:outline-none"
            />
          </div>
          <div className="flex gap-2">
            <div className="flex-1">
              <label htmlFor="search-filter-from" className="text-[10px] text-[var(--muted)] uppercase block mb-0.5">From</label>
              <input
                id="search-filter-from"
                type="date"
                value={filterDateFrom}
                onChange={(e) => setFilterDateFrom(e.target.value)}
                className="w-full px-2 py-1 text-xs bg-[var(--panel)] text-[var(--text)] border border-[var(--accent-2)]/30 rounded focus:outline-none"
              />
            </div>
            <div className="flex-1">
              <label htmlFor="search-filter-to" className="text-[10px] text-[var(--muted)] uppercase block mb-0.5">To</label>
              <input
                id="search-filter-to"
                type="date"
                value={filterDateTo}
                onChange={(e) => setFilterDateTo(e.target.value)}
                className="w-full px-2 py-1 text-xs bg-[var(--panel)] text-[var(--text)] border border-[var(--accent-2)]/30 rounded focus:outline-none"
              />
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={applyFilters}
              disabled={!query.trim()}
              className="flex-1 py-1 text-xs bg-[var(--accent-2)] text-[var(--text)] rounded hover:bg-[var(--accent)] transition-colors disabled:opacity-50"
            >
              Apply
            </button>
            <button
              onClick={clearFilters}
              disabled={!hasFilters}
              className="flex-1 py-1 text-xs bg-[var(--panel)] text-[var(--muted)] rounded hover:text-[var(--text)] transition-colors disabled:opacity-50"
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

        {!searching && searched && error && (
          <div className="px-4 py-8 text-center text-sm text-[var(--muted)]">
            <p>Search failed.</p>
            <button onClick={applyFilters} className="mt-2 text-xs text-[var(--accent)] hover:underline">
              Try again
            </button>
          </div>
        )}

        {!searching && searched && !error && results.length === 0 && (
          <div className="px-4 py-8 text-center text-sm text-[var(--muted)]">
            No results found for &ldquo;{query}&rdquo;{hasFilters ? " with these filters" : ""}
          </div>
        )}

        {!searching && results.map((r) => {
          const blocked = blockedUserIds?.has(r.author.id) ?? false;
          return (
            <BlockedMessageGate
              key={`${r.id}:${blocked ? "blocked" : "visible"}`}
              blocked={blocked}
              className="border-b border-[var(--accent-2)]/10 px-3 py-2.5"
            >
              <button
                onClick={() => onJumpToMessage?.(r.channel.id, r.id)}
                title="Jump to message"
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
            </BlockedMessageGate>
          );
        })}

        {!searching && !searched && (
          <div className="px-4 py-8 text-center text-sm text-[var(--muted)]">
            Search messages in this server
          </div>
        )}
      </div>
    </div>
  );
}
