"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Menu, X } from "lucide-react";
import type { NavSection } from "./NavDropdown";

interface MobileNavProps {
  sections: NavSection[];
  /** Tailwind breakpoint class controlling when the hamburger shows. */
  breakpointClass?: string;
}

/**
 * Mobile hamburger menu. Renders the nav grouped into logical sections so
 * small screens get a compact drawer instead of a full-size bar. Defaults to
 * the dashboard's lg breakpoint; pass e.g. "sm:hidden" for lighter layouts.
 *
 * The drawer is anchored to the VIEWPORT (fixed, right-aligned) rather than
 * the toggle button — an `absolute right-0` panel anchored to a button near
 * the left edge of a narrow screen used to extend left past the visible
 * window, rendering the menu invisible/unusable.
 */
export default function MobileNav({
  sections,
  breakpointClass = "lg:hidden",
}: MobileNavProps) {
  const [open, setOpen] = useState(false);

  // Close the drawer with Escape.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  // Lock body scroll while the drawer is open.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  return (
    <div className={`${breakpointClass} relative`}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center justify-center rounded-md border border-input bg-background p-2 hover:bg-muted transition-colors"
        aria-label="Toggle navigation menu"
        aria-expanded={open}
      >
        {open ? <X className="size-5" /> : <Menu className="size-5" />}
      </button>

      {open &&
        // Portal to <body> so no ancestor (sticky header, transform, overflow)
        // can affect the fixed positioning — the drawer always renders
        // viewport-anchored, above the header.
        createPortal(
          <>
            <div
              className="fixed inset-0 z-[60] bg-black/30"
              onClick={() => setOpen(false)}
              aria-hidden="true"
            />
            <div
              className="fixed inset-y-0 right-0 z-[70] flex w-72 max-w-[85vw] flex-col overflow-y-auto border-l bg-popover shadow-xl"
            >
              <div className="flex items-center justify-between border-b px-4 py-3">
                <span className="text-sm font-semibold">Menu</span>
                <button
                  onClick={() => setOpen(false)}
                  className="rounded-md p-1.5 hover:bg-muted transition-colors"
                  aria-label="Close navigation menu"
                >
                  <X className="size-4" />
                </button>
              </div>
              <div className="p-2">
                {sections.map((section) => (
                  <div key={section.label} className="mb-1">
                    <div className="px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-widest text-primary">
                      {section.label}
                    </div>
                    {section.items.map((item) => (
                      <a
                        key={item.href}
                        href={item.href}
                        onClick={() => setOpen(false)}
                        className="block rounded-sm px-3 py-2 text-sm hover:bg-muted transition-colors"
                      >
                        {item.label}
                      </a>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          </>,
          document.body
        )}
    </div>
  );
}
