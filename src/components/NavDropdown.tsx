"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { ChevronDown } from "lucide-react";

export interface NavSection {
  label: string;
  items: { href: string; label: string }[];
}

/** Desktop grouped nav: one dropdown per logical section. */
export default function NavDropdown({ sections }: { sections: NavSection[] }) {
  const [open, setOpen] = useState<string | null>(null);
  const pathname = usePathname();
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(null);
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  // Close when the route changes.
  useEffect(() => {
    setOpen(null);
  }, [pathname]);

  return (
    <div ref={rootRef} className="hidden lg:flex items-center gap-1">
      {sections.map((section) => {
        const active = section.items.some((i) =>
          pathname === i.href || pathname.startsWith(i.href + "/")
        );
        const isOpen = open === section.label;
        return (
          <div key={section.label} className="relative">
            <button
              onClick={() => setOpen(isOpen ? null : section.label)}
              className={`flex items-center gap-1 px-2 py-1 rounded text-xs sm:text-sm whitespace-nowrap transition-colors ${
                active ? "text-primary font-medium" : "hover:text-primary"
              }`}
              aria-expanded={isOpen}
              aria-haspopup="menu"
            >
              {section.label}
              <ChevronDown
                className={`size-3.5 opacity-60 transition-transform ${isOpen ? "rotate-180" : ""}`}
              />
            </button>
            {isOpen && (
              <div
                className="absolute left-0 top-full mt-1 w-52 rounded-md border bg-popover p-1 shadow-md z-50"
                role="menu"
              >
                {section.items.map((item) => {
                  const itemActive =
                    pathname === item.href || pathname.startsWith(item.href + "/");
                  return (
                    <a
                      key={item.href}
                      href={item.href}
                      role="menuitem"
                      className={`block rounded-sm px-3 py-2 text-sm transition-colors ${
                        itemActive
                          ? "bg-muted text-primary font-medium"
                          : "hover:bg-muted"
                      }`}
                    >
                      {item.label}
                    </a>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
