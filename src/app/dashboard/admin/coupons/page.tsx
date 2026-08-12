"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Ticket, Plus, Copy, Check } from "lucide-react";

interface Coupon {
  id: string;
  code: string;
  percent_off: number;
  plan_id: string | null;
  expires_at: string | null;
  max_uses: number | null;
  used_count: number;
  active: boolean;
  created_at: string;
}

export default function AdminCouponsPage() {
  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  const [code, setCode] = useState("");
  const [percentOff, setPercentOff] = useState("20");
  const [planId, setPlanId] = useState("");
  const [maxUses, setMaxUses] = useState("");
  const [expiresAt, setExpiresAt] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/coupons", { credentials: "include" });
      if (res.ok) {
        const data = await res.json();
        setCoupons(data.coupons ?? []);
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "Failed to load coupons");
      }
    } catch {
      setError("Failed to load coupons");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const create = async () => {
    setCreating(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/coupons", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code,
          percentOff,
          planId,
          maxUses,
          expiresAt,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Failed to create coupon");
        return;
      }
      setCode("");
      setPlanId("");
      setMaxUses("");
      setExpiresAt("");
      load();
    } catch (err: any) {
      setError(err.message ?? "Failed to create coupon");
    } finally {
      setCreating(false);
    }
  };

  const copyCode = async (c: string) => {
    try {
      await navigator.clipboard.writeText(c);
      setCopied(c);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      // ignore
    }
  };

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <Ticket className="size-6 text-primary" /> Coupon Codes
        </h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Issue discount codes (super admin only). Any tenant can apply a code
          at subscription checkout or upgrade — the discount is applied by
          Stripe at purchase time.
        </p>
      </div>

      {error && (
        <div className="p-3 rounded-md bg-red-50 text-red-700 border border-red-200 text-sm">{error}</div>
      )}

      {/* Issue form */}
      <Card className="p-5">
        <h2 className="text-sm font-semibold mb-3 flex items-center gap-2">
          <Plus className="size-4 text-primary" /> Issue a code
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="space-y-1.5">
            <Label className="text-xs">Code</Label>
            <Input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="SUMMER30" className="uppercase" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">% off (1-100)</Label>
            <Input type="number" min={1} max={100} value={percentOff} onChange={(e) => setPercentOff(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Plan (optional)</Label>
            <Input value={planId} onChange={(e) => setPlanId(e.target.value)} placeholder="e.g. growth — blank = any" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Max uses (optional)</Label>
            <Input type="number" min={1} value={maxUses} onChange={(e) => setMaxUses(e.target.value)} placeholder="Unlimited" />
          </div>
        </div>
        <div className="mt-3">
          <Label className="text-xs">Expires (optional)</Label>
          <Input type="datetime-local" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} className="mt-1.5 max-w-xs" />
        </div>
        <Button onClick={create} disabled={creating || code.trim().length < 3} className="mt-4">
          {creating ? <Loader2 className="size-4 animate-spin mr-1" /> : <Ticket className="size-4 mr-1" />}
          Issue coupon
        </Button>
      </Card>

      {/* List */}
      {loading ? (
        <div className="flex justify-center py-12"><Loader2 className="size-6 animate-spin text-muted-foreground" /></div>
      ) : coupons.length === 0 ? (
        <Card className="p-10 text-center text-muted-foreground text-sm">
          No coupon codes yet — issue your first one above.
        </Card>
      ) : (
        <div className="rounded-lg border divide-y">
          {coupons.map((c) => (
            <div key={c.id} className="flex items-center justify-between gap-3 p-4 flex-wrap">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <button
                    onClick={() => copyCode(c.code)}
                    className="font-mono font-semibold text-sm hover:underline flex items-center gap-1"
                    title="Copy code"
                  >
                    {c.code}
                    {copied === c.code ? <Check className="size-3.5 text-green-600" /> : <Copy className="size-3.5 text-muted-foreground" />}
                  </button>
                  <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
                    {c.percent_off}% off
                  </span>
                  {!c.active && (
                    <span className="text-xs px-2 py-0.5 rounded-full bg-red-100 text-red-700">Inactive</span>
                  )}
                  {c.plan_id && (
                    <span className="text-xs px-2 py-0.5 rounded-full bg-blue-100 text-blue-700">Plan: {c.plan_id}</span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  {c.used_count} use{c.used_count === 1 ? "" : "s"}
                  {c.max_uses != null ? ` of ${c.max_uses}` : " (unlimited)"}
                  {c.expires_at ? ` · expires ${new Date(c.expires_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}` : " · no expiry"}
                  {" · "}issued {new Date(c.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
