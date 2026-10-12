"use client";
import { useEffect, useState } from "react";

import { DEFAULT_THEME, THEME_LABELS, THEMES, type Theme } from "@/lib/themes";

export { THEMES, THEME_LABELS } from "@/lib/themes";

function loadCustomTheme(): Record<string, string> | null {
  if (typeof window === "undefined") return null;
  try {
    const saved = localStorage.getItem("campfire-custom-theme");
    return saved ? JSON.parse(saved) : null;
  } catch { return null; }
}

function loadInitialTheme(): Theme {
  if (typeof window === "undefined") return DEFAULT_THEME;
  try {
    const savedTheme = localStorage.getItem("campfire-theme") as Theme | null;
    if (savedTheme && THEMES[savedTheme]) return savedTheme;
  } catch {}
  return DEFAULT_THEME;
}

export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(loadInitialTheme);
  const [customColors, setCustomColorsState] = useState<Record<string, string>>(() => {
    const saved = loadCustomTheme();
    if (saved) THEMES.custom = saved;
    return saved ?? THEMES.custom;
  });

  useEffect(() => {
    const vars = theme === "custom" ? customColors : THEMES[theme];
    const root = document.documentElement;
    Object.entries(vars).forEach(([key, val]) => root.style.setProperty(key, val));
    root.setAttribute("data-theme", theme);
    try { localStorage.setItem("campfire-theme", theme); } catch {}
  }, [customColors, theme]);

  function setTheme(t: Theme) {
    setThemeState(t);
  }

  function setCustomColors(colors: Record<string, string>) {
    THEMES.custom = colors;
    setCustomColorsState(colors);
    try { localStorage.setItem("campfire-custom-theme", JSON.stringify(colors)); } catch {}
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
