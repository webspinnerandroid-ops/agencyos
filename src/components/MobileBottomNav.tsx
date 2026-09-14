"use client";

import { useEffect, useState } from "react";
import {
  Home,
  Sparkles,
  Map as MapIcon,
  FileText,
} from "lucide-react";
import type { NavSection } from "./NavDropdown";
import MobileNav from "./MobileNav";

/**
 * Mobile bottom navigation — the blueprint's five daily destinations as
 * fixed 48px+ targets, always one tap away (no hamburger-first wayfinding).
 *
 * Home / Create / Plan / Posts are fixed; the fifth slot ("More") opens the
 * full grouped drawer, so nothing is unreachable. Destinations resolve from
 * the tenant's actual nav (custom Menu Builder configs included) and fall
 * back to the built-ins when a section is missing.
 *
 * Renders inside the dashboard layout only; <main> carries pb-20 sm:pb-6 so
 * content clears the bar.
 */
export default function MobileBottomNav({
  sections,
}: {
  sections: NavSection[];
}) {
  const [path, setPath] = useState<string>("");

  useEffect(() => {
    setPath(window.location.pathname);
    const onPop = () => setPath(window.location.pathname);
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const findHref = (label: string, fallback: string): string =>
    sections
      .flatMap((s) => s.items ?? [])
      .find((i) => i.label === label)?.href ?? fallback;

  const destinations = [
    { href: "/dashboard", label: "Home", Icon: Home },
    { href: findHref("Generate", "/dashboard/generate"), label: "Create", Icon: Sparkles },
    {
      href: findHref("Content Map", "/dashboard/content-map"),
      label: "Plan",
      Icon: MapIcon,
    },
    { href: findHref("Posts", "/dashboard/posts"), label: "Posts", Icon: FileText },
  ];

  return (
    <nav
      aria-label="Primary"
      className="sm:hidden fixed bottom-0 inset-x-0 z-40 border-t bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80"
    >
      <div className="grid grid-cols-5">
        {destinations.map(({ href, label, Icon }) => {
          const active =
            path === href ||
            (href !== "/dashboard" && path.startsWith(href + "/"));
          return (
            <a
              key={href}
              href={href}
              aria-current={active ? "page" : undefined}
              className={`flex min-h-14 flex-col items-center justify-center gap-0.5 text-[10px] transition-colors ${
                active ? "text-primary" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Icon className="size-5" />
              {label}
            </a>
          );
        })}
        {/* More — opens the full grouped drawer (Settings, SEO, Analytics,
            Connections, Profile…). Reuses MobileNav's portal drawer with its
            scroll lock and Escape handling. */}
        <div className="flex min-h-14 flex-col items-center justify-center gap-0.5 text-[10px] text-muted-foreground">
          <MobileNav sections={sections} breakpointClass="" bareIcon />
          <span>More</span>
        </div>
      </div>
    </nav>
  );
}
