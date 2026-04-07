"use client";
import { useEffect, useState } from "react";

type Theme = "dark" | "light" | "midnight";

export const THEMES: Record<Theme, Record<string, string>> = {
  dark: {
    "--bg": "#0b1210",
    "--panel": "#121b18",
    "--panel-2": "#1a2521",
    "--text": "#e7ecea",
    "--muted": "#94a39d",
    "--accent": "#b7bcc9",
    "--accent-2": "#5f7a70",
    "--danger": "#7a2f2f",
  },
  light: {
    "--bg": "#f0ece4",
    "--panel": "#e6e1d8",
    "--panel-2": "#d9d3c8",
    "--text": "#1a2220",
    "--muted": "#5a6a63",
    "--accent": "#3a5a50",
    "--accent-2": "#4a7a6a",
    "--danger": "#a83232",
  },
  midnight: {
    "--bg": "#050810",
    "--panel": "#0a0f1e",
    "--panel-2": "#111827",
    "--text": "#e2e8f0",
    "--muted": "#64748b",
    "--accent": "#818cf8",
    "--accent-2": "#4f46e5",
    "--danger": "#ef4444",
  },
};

export function useTheme() {
  const [theme, setThemeState] = useState<Theme>("dark");

  useEffect(() => {
    // Detect system preference on first visit
    const saved = localStorage.getItem("campfire-theme") as Theme | null;
    if (saved && THEMES[saved]) {
      applyTheme(saved);
      setThemeState(saved);
    } else if (window.matchMedia("(prefers-color-scheme: light)").matches) {
      applyTheme("light");
      setThemeState("light");
    }
  }, []);

  function applyTheme(t: Theme) {
    const vars = THEMES[t];
    const root = document.documentElement;
    Object.entries(vars).forEach(([key, val]) => root.style.setProperty(key, val));
    root.setAttribute("data-theme", t);
    localStorage.setItem("campfire-theme", t);
  }

  function setTheme(t: Theme) {
    applyTheme(t);
    setThemeState(t);
  }

  return { theme, setTheme, themes: Object.keys(THEMES) as Theme[] };
}
