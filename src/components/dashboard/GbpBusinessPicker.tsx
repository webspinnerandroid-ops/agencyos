"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { BadgeCheck, Loader2, MapPin, Store } from "lucide-react";
import type { GbpOption, GoogleBusinessProfile } from "@/app/dashboard/settings/gbp/actions";
import {
  connectSelectedGbpProfiles,
  listGbpOptions,
} from "@/app/dashboard/settings/gbp/actions";

interface GbpBusinessPickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called with the freshly connected profiles after a successful save. */
  onConnected: (profiles: GoogleBusinessProfile[]) => void;
  /** Surface errors to the page's feedback banner. */
  onError: (message: string) => void;
}

export default function GbpBusinessPicker({
  open,
  onOpenChange,
  onConnected,
  onError,
}: GbpBusinessPickerProps) {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [options, setOptions] = useState<GbpOption[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loadError, setLoadError] = useState<string | null>(null);

  const allSelected = options.length > 0 && selected.size === options.length;

  const sortedOptions = useMemo(
    () => [...options].sort((a, b) => a.name.localeCompare(b.name)),
    [options]
  );

  const loadOptions = async () => {
    setLoading(true);
    setLoadError(null);
    const res = await listGbpOptions();
    setLoading(false);
    if (!res.success || !res.data) {
      setLoadError(res.error ?? "Failed to load businesses from Google.");
      return;
    }
    setOptions(res.data);
    // Pre-check businesses that are already connected.
    setSelected(new Set(res.data.filter((o) => o.already_connected).map((o) => o.location_id)));
  };

  // Lazy-load the business list the first time the dialog opens.
  const handleOpenChange = (next: boolean) => {
    if (next && options.length === 0 && !loading && !loadError) {
      void loadOptions();
    }
    onOpenChange(next);
  };

  const toggle = (locationId: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(locationId)) next.delete(locationId);
      else next.add(locationId);
      return next;
    });
  };

  const toggleAll = () => {
    setSelected(allSelected ? new Set() : new Set(options.map((o) => o.location_id)));
  };

  const handleConnect = async () => {
    const picked = options.filter((o) => selected.has(o.location_id));
    if (picked.length === 0) return;
    setSaving(true);
    const res = await connectSelectedGbpProfiles(
      picked.map((o) => ({
        location_id: o.location_id,
        name: o.name,
        account: o.account,
        address: o.address,
      }))
    );
    setSaving(false);
    if (!res.success || !res.data) {
      onError(res.error ?? "Failed to connect the selected businesses.");
      return;
    }
    onConnected(res.data);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Store className="size-5 text-primary" /> Choose businesses to connect
          </DialogTitle>
          <DialogDescription>
            Pick which Google Business Profile listings this workspace should manage.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center gap-2 py-8 justify-center text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Loading businesses from Google…
          </div>
        ) : loadError ? (
          <div className="space-y-3">
            <p className="text-sm text-red-600 dark:text-red-400">{loadError}</p>
            <Button variant="outline" size="sm" onClick={() => void loadOptions()}>
              Try again
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
              <input
                type="checkbox"
                checked={allSelected}
                ref={(el) => {
                  if (el) el.indeterminate = selected.size > 0 && !allSelected;
                }}
                onChange={toggleAll}
                className="size-4 accent-emerald-600"
              />
              Select all ({selected.size}/{options.length})
            </label>
            <div className="max-h-72 overflow-y-auto rounded-md border divide-y">
              {sortedOptions.map((opt) => (
                <label
                  key={opt.location_id}
                  className="flex items-start gap-3 px-3 py-2.5 cursor-pointer hover:bg-muted/50"
                >
                  <input
                    type="checkbox"
                    checked={selected.has(opt.location_id)}
                    onChange={() => toggle(opt.location_id)}
                    className="size-4 mt-0.5 accent-emerald-600 shrink-0"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5 text-sm font-medium">
                      <span className="truncate">{opt.name}</span>
                      {opt.already_connected && (
                        <BadgeCheck className="size-3.5 text-green-600 shrink-0" />
                      )}
                    </span>
                    {opt.address && (
                      <span className="flex items-center gap-1 text-xs text-muted-foreground mt-0.5">
                        <MapPin className="size-3 shrink-0" />
                        <span className="truncate">{opt.address}</span>
                      </span>
                    )}
                    <span className="block text-xs text-muted-foreground/70 truncate mt-0.5">
                      {opt.account}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button
            onClick={() => void handleConnect()}
            disabled={saving || loading || selected.size === 0}
          >
            {saving ? (
              <>
                <Loader2 className="size-4 animate-spin mr-1" /> Connecting…
              </>
            ) : (
              `Connect ${selected.size || ""} ${selected.size === 1 ? "business" : "businesses"}`
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
