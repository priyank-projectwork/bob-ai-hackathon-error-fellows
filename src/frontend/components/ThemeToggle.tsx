"use client";
import { useEffect, useState } from "react";

type Theme = "dark" | "light" | "system";

/**
 * Dark is the default — a control tower runs at night. Light exists because
 * projectors and compressed video destroy dark interfaces, and this has to be
 * readable in a room with the lights on.
 */
export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("system");

  useEffect(() => {
    const stored = (() => {
      try { return localStorage.getItem("lc-theme") as Theme | null; } catch { return null; }
    })();
    if (stored) setTheme(stored);
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    if (theme === "system") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", theme);
    try { localStorage.setItem("lc-theme", theme); } catch { /* private mode */ }
  }, [theme]);

  const options: { value: Theme; label: string }[] = [
    { value: "light", label: "Light" },
    { value: "system", label: "Auto" },
    { value: "dark", label: "Dark" },
  ];

  return (
    <div className="flex items-center gap-1" role="group" aria-label="Colour theme">
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => setTheme(o.value)}
          aria-pressed={theme === o.value}
          className="lc-btn px-2.5 py-1 text-xs"
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
