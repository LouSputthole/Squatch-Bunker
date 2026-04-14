"use client";
import { useEffect, useState } from "react";

type Theme = "dark" | "light" | "midnight" | "campfire" | "ocean" | "dracula" | "nord" | "solarized" | "custom";

export const THEME_LABELS: Record<string, string> = {
  dark: "Forest Dark",
  light: "Forest Light",
  midnight: "Midnight",
  campfire: "Campfire",
  ocean: "Deep Ocean",
  dracula: "Dracula",
  nord: "Nord",
  solarized: "Solarized",
  custom: "Custom",
};

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
  campfire: {
    "--bg": "#1a0e08",
    "--panel": "#2a1a10",
    "--panel-2": "#3a2518",
    "--text": "#f5e6d3",
    "--muted": "#b8937a",
    "--accent": "#ff9b50",
    "--accent-2": "#c76a2e",
    "--danger": "#cc3333",
  },
  ocean: {
    "--bg": "#0a1628",
    "--panel": "#0f1f38",
    "--panel-2": "#162a48",
    "--text": "#e0eaf5",
    "--muted": "#6889b0",
    "--accent": "#4fc3f7",
    "--accent-2": "#1976d2",
    "--danger": "#e53935",
  },
  dracula: {
    "--bg": "#282a36",
    "--panel": "#1e1f29",
    "--panel-2": "#343746",
    "--text": "#f8f8f2",
    "--muted": "#6272a4",
    "--accent": "#bd93f9",
    "--accent-2": "#6d4aad",
    "--danger": "#ff5555",
  },
  nord: {
    "--bg": "#2e3440",
    "--panel": "#272c36",
    "--panel-2": "#3b4252",
    "--text": "#eceff4",
    "--muted": "#7b88a1",
    "--accent": "#88c0d0",
    "--accent-2": "#5e81ac",
    "--danger": "#bf616a",
  },
  solarized: {
    "--bg": "#002b36",
    "--panel": "#073642",
    "--panel-2": "#0a4050",
    "--text": "#fdf6e3",
    "--muted": "#839496",
    "--accent": "#b58900",
    "--accent-2": "#268bd2",
    "--danger": "#dc322f",
  },
  custom: {
    "--bg": "#0b1210",
    "--panel": "#121b18",
    "--panel-2": "#1a2521",
    "--text": "#e7ecea",
    "--muted": "#94a39d",
    "--accent": "#b7bcc9",
    "--accent-2": "#5f7a70",
    "--danger": "#7a2f2f",
  },
};

function loadCustomTheme(): Record<string, string> | null {
  if (typeof window === "undefined") return null;
  try {
    const saved = localStorage.getItem("campfire-custom-theme");
    return saved ? JSON.parse(saved) : null;
  } catch { return null; }
}

export function useTheme() {
  const [theme, setThemeState] = useState<Theme>("dark");
  const [customColors, setCustomColorsState] = useState<Record<string, string>>(THEMES.custom);

  useEffect(() => {
    // Load custom theme colors
    const saved = loadCustomTheme();
    if (saved) {
      THEMES.custom = saved;
      setCustomColorsState(saved);
    }

    // Detect system preference on first visit
    const savedTheme = localStorage.getItem("campfire-theme") as Theme | null;
    if (savedTheme && THEMES[savedTheme]) {
      applyTheme(savedTheme);
      setThemeState(savedTheme);
    } else if (window.matchMedia("(prefers-color-scheme: light)").matches) {
      applyTheme("light");
      setThemeState("light");
    }
  }, []);

  function applyTheme(t: Theme) {
    const vars = t === "custom" ? customColors : THEMES[t];
    const root = document.documentElement;
    Object.entries(vars).forEach(([key, val]) => root.style.setProperty(key, val));
    root.setAttribute("data-theme", t);
    localStorage.setItem("campfire-theme", t);
  }

  function setTheme(t: Theme) {
    applyTheme(t);
    setThemeState(t);
  }

  function setCustomColors(colors: Record<string, string>) {
    THEMES.custom = colors;
    setCustomColorsState(colors);
    localStorage.setItem("campfire-custom-theme", JSON.stringify(colors));
    if (theme === "custom") applyTheme("custom");
  }

  return {
    theme,
    setTheme,
    themes: Object.keys(THEMES) as Theme[],
    customColors,
    setCustomColors,
    themeLabels: THEME_LABELS,
  };
}
