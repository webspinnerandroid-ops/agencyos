"use client";

import { useEffect, useState } from "react";
import { Search } from "lucide-react";

/**
 * Visible trigger for the ⌘K command palette. The palette itself lives in
 * the layout; opening it is dispatched on a well-known DOM event so this
 * button stays decoupled from the palette's internal state.
 */
export default function SearchTrigger() {
  const [isMac, setIsMac] = useState(true);

  useEffect(() => {
    setIsMac(/Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent));
  }, []);

  return (
    <button
      type="button"
      aria-label="Search (Ctrl+K)"
      title="Search pages and clients"
      onClick={() =>
        document.dispatchEvent(new CustomEvent("open-command-palette"))
      }
      className="hidden sm:inline-flex h-9 w-9 items-center justify-center rounded-md border border-input bg-background text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
    >
      <Search className="size-4" />
      <kbd className="sr-only">{isMac ? "Command K" : "Control K"}</kbd>
    </button>
  );
}
