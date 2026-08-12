"use client";

import { useEffect, useState } from "react";
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

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} aria-hidden="true" />
          <div className="absolute right-0 mt-1 z-50 w-64 max-h-[80vh] overflow-y-auto rounded-md border bg-popover p-2 shadow-md">
            {sections.map((section) => (
              <div key={section.label} className="mb-1">
                <div className="px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
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
        </>
      )}
    </div>
  );
}
