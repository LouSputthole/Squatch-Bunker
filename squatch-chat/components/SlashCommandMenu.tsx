"use client";

import { useMemo } from "react";

export interface SlashCommand {
  name: string;
  description: string;
  execute: (args: string) => string;
}

export const SLASH_COMMANDS: SlashCommand[] = [
  { name: "shrug", description: "Appends ¯\\_(ツ)_/¯", execute: (args) => `${args} ¯\\_(ツ)_/¯`.trim() },
  { name: "tableflip", description: "Appends (╯°□°)╯︵ ┻━┻", execute: (args) => `${args} (╯°□°)╯︵ ┻━┻`.trim() },
  { name: "unflip", description: "Appends ┬─┬ ノ( ゜-゜ノ)", execute: (args) => `${args} ┬─┬ ノ( ゜-゜ノ)`.trim() },
  { name: "lenny", description: "Appends ( ͡° ͜ʖ ͡°)", execute: (args) => `${args} ( ͡° ͜ʖ ͡°)`.trim() },
  { name: "disapproval", description: "Appends ಠ_ಠ", execute: (args) => `${args} ಠ_ಠ`.trim() },
  { name: "sparkles", description: "Wraps text in ✨sparkles✨", execute: (args) => `✨ ${args || "sparkles"} ✨` },
  { name: "me", description: "Posts action text in italics", execute: (args) => `_${args}_` },
  { name: "spoiler", description: "Wraps text in spoiler tags", execute: (args) => `||${args || "spoiler"}||` },
];

interface SlashCommandMenuProps {
  query: string;
  onSelect: (command: SlashCommand) => void;
  onClose: () => void;
}

export default function SlashCommandMenu({ query, onSelect, onClose }: SlashCommandMenuProps) {
  const filtered = useMemo(() => {
    const q = query.toLowerCase();
    return SLASH_COMMANDS.filter((cmd) => cmd.name.startsWith(q));
  }, [query]);

  if (filtered.length === 0) return null;

  return (
    <div className="absolute bottom-full left-0 mb-1 w-72 bg-[var(--panel)] border border-[var(--accent-2)]/30 rounded-lg shadow-xl py-1 z-50">
      <div className="px-3 py-1 text-[10px] text-[var(--muted)] uppercase font-semibold">Commands</div>
      {filtered.map((cmd) => (
        <button
          key={cmd.name}
          onClick={() => { onSelect(cmd); onClose(); }}
          className="w-full px-3 py-2 text-left hover:bg-[var(--accent-2)]/20 flex items-center gap-3 transition-colors"
        >
          <span className="text-sm font-mono text-[var(--accent-2)]">/{cmd.name}</span>
          <span className="text-xs text-[var(--muted)]">{cmd.description}</span>
        </button>
      ))}
    </div>
  );
}
