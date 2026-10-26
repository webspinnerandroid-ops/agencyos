"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Menu, X } from "lucide-react";
import type { NavSection } from "./NavDropdown";
import WorkspaceSelector from "./WorkspaceSelector";

interface MobileNavProps {
  sections: NavSection[];
  /** Tailwind breakpoint class controlling when the hamburger shows. */
  breakpointClass?: string;
  /** Borderless icon-only trigger (bottom-nav "More" slot styling). */
  bareIcon?: boolean;
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
  bareIcon = false,
}: MobileNavProps) {
  const [open, setOpen] = useState(false);
  const titleId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const close = useCallback(() => setOpen(false), []);

  // Escape closes; Tab is trapped inside the panel while it is open (a drawer
  // that swallows the page visually but lets focus wander behind it leaves
  // keyboard and screen-reader users on controls they cannot see).
  useEffect(() => {
    if (!open) return;
    const panel = panelRef.current;

    const focusable = () =>
      Array.from(
        panel?.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        ) ?? []
      ).filter((el) => el.offsetParent !== null || el === document.activeElement);

    // Move focus into the drawer (the close button) once it is mounted.
    const first = focusable()[0];
    first?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close();
        return;
      }
      if (e.key !== "Tab") return;
      const items = focusable();
      if (items.length === 0) return;
      const firstEl = items[0];
      const lastEl = items[items.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey && (active === firstEl || !active || !panel?.contains(active))) {
        e.preventDefault();
        lastEl.focus();
      } else if (!e.shiftKey && active === lastEl) {
        e.preventDefault();
        firstEl.focus();
      }
    };

    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      // Return focus to the trigger that opened the drawer.
      triggerRef.current?.focus();
    };
  }, [open, close]);

  // Lock page scroll while the drawer is open.
  // body overflow: hidden alone does NOT lock the viewport here: the global
  // stylesheet gives <html> a non-visible overflow-x (clip), and once the root
  // element carries any non-visible overflow the CSS overflow-propagation rule
  // stops forwarding body's overflow to the viewport — the html scroller
  // (document.scrollingElement) stays scrollable and the page slides behind
  // the drawer. Locking html directly covers the viewport scroller.
  useEffect(() => {
    if (!open) return;
    const prevBody = document.body.style.overflow;
    const prevHtml = document.documentElement.style.overflow;
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prevBody;
      document.documentElement.style.overflow = prevHtml;
    };
  }, [open]);

  return (
    <div className={`${breakpointClass} relative`}>
      <button
        ref={triggerRef}
        onClick={() => setOpen((v) => !v)}
        className={
          bareIcon
            ? "flex size-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:text-foreground"
            : "flex items-center justify-center rounded-md border border-input bg-background p-2 hover:bg-muted transition-colors"
        }
        aria-label="Toggle navigation menu"
        aria-expanded={open}
        aria-haspopup="dialog"
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
              style={{ position: "fixed", inset: 0, zIndex: 60, backgroundColor: "rgba(0,0,0,0.3)" }}
              onClick={close}
              aria-hidden="true"
            />
            <div
              ref={panelRef}
              role="dialog"
              aria-modal="true"
              aria-labelledby={titleId}
              className="fixed inset-y-0 right-0 z-[70] flex w-72 max-w-[85vw] flex-col overflow-y-auto border-l bg-popover shadow-xl"
              style={{
                position: "fixed",
                top: 0,
                bottom: 0,
                right: 0,
                zIndex: 70,
                width: "min(18rem, 85vw)",
                display: "flex",
                flexDirection: "column",
                overflowY: "auto",
                backgroundColor: "var(--popover, hsl(0 0% 100%))",
                color: "var(--popover-foreground, hsl(0 0% 10%))",
              }}
            >
              <div className="flex items-center justify-between border-b px-4 py-3">
                <span id={titleId} className="text-sm font-semibold">
                  Menu
                </span>
                <button
                  onClick={close}
                  className="rounded-md p-1.5 hover:bg-muted transition-colors"
                  aria-label="Close navigation menu"
                >
                  <X className="size-4" />
                </button>
              </div>
              <div className="border-b px-3 py-2.5">
                <WorkspaceSelector />
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
