"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { createBrowserClient } from "@supabase/ssr";
import { LogOut, User, ChevronDown, Download } from "lucide-react";
import {
  isInstallAvailable,
  isIosSafari,
  onInstallAvailable,
  promptInstall,
} from "@/lib/pwa-install";

interface AccountMenuProps {
  email: string;
}

export default function AccountMenu({ email }: AccountMenuProps) {
  const [open, setOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [installReady, setInstallReady] = useState(false);

  // Follow the captured install prompt: show the button only while the
  // browser has one available (Android Chrome / desktop). iOS has no prompt
  // API — the menu shows Add-to-Home-Screen instructions instead.
  useEffect(() => onInstallAvailable(setInstallReady), []);

  const handleInstall = async () => {
    const accepted = await promptInstall();
    if (!accepted) setInstallReady(false);
  };

  const handleSignOut = async () => {
    setSigningOut(true);
    try {
      const supabase = createBrowserClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
      );
      await supabase.auth.signOut();
    } catch (err) {
      console.error("[AccountMenu] signOut error:", err);
    }
    // Hard navigation so middleware re-evaluates with no session
    window.location.href = "/login";
  };

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 rounded-md border border-input bg-background px-2 py-1.5 text-xs sm:text-sm hover:bg-muted transition-colors"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <User className="size-4 shrink-0" />
        <span className="max-w-[120px] truncate hidden sm:inline">{email}</span>
        <ChevronDown className="size-3.5 shrink-0 opacity-60" />
      </button>

      {open &&
        createPortal(
          <>
          <div className="fixed inset-0 z-[60]" onClick={() => setOpen(false)} aria-hidden="true" />
          <div className="fixed right-2 top-14 z-[70] w-56 rounded-md border bg-popover p-1 shadow-md" role="menu">
            <div className="px-3 py-2 text-xs text-muted-foreground border-b mb-1 truncate">
              {email}
            </div>
            {installReady && (
              <button
                onClick={handleInstall}
                className="w-full flex items-center gap-2 rounded-sm px-3 py-2 text-sm hover:bg-muted transition-colors"
                role="menuitem"
              >
                <Download className="size-4" />
                Install app
              </button>
            )}
            {isIosSafari() && !installReady && (
              <div className="px-3 py-2 text-xs text-muted-foreground">
                Install: share menu → <strong>Add to Home Screen</strong>
              </div>
            )}
            <button
              onClick={handleSignOut}
              disabled={signingOut}
              className="w-full flex items-center gap-2 rounded-sm px-3 py-2 text-sm hover:bg-muted transition-colors disabled:opacity-50"
              role="menuitem"
            >
              <LogOut className="size-4" />
              {signingOut ? "Signing out..." : "Sign out"}
            </button>
          </div>
          </>,
          document.body
        )}
    </div>
  );
}