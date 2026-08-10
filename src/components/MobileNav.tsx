"use client";

import { useState } from "react";
import { Menu, X } from "lucide-react";

interface MobileNavProps {
  items: { href: string; label: string }[];
}

export default function MobileNav({ items }: MobileNavProps) {
  const [open, setOpen] = useState(false);

  return (
    <div className="lg:hidden relative">
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
          <div className="absolute right-0 mt-1 z-50 w-52 rounded-md border bg-popover p-1 shadow-md">
            {items.map((item) => (
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
        </>
      )}
    </div>
  );
}