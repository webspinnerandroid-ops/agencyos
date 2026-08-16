"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Loader2, Coins, Plus, Trash2, Save } from "lucide-react";
import {
  getTokenBilling,
  saveModelRate,
  deleteModelRate,
  savePlan,
  deletePlan,
  saveAddon,
  deleteAddon,
  type TokenBillingData,
  type ModelRate,
  type TokenPlan,
  type TokenAddon,
} from "./token-billing-actions";

export default function TokenBilling() {
  const [data, setData] = useState<TokenBillingData>({ rates: [], plans: [], addons: [] });
  const [loading, setLoading] = useState(true);
  const [feedback, setFeedback] = useState<{ type: "ok" | "err"; msg: string } | null>(null);
  const [pending, setPending] = useState<string | null>(null);

  // Editable local copies
  const [rateDrafts, setRateDrafts] = useState<Record<string, { input: string; output: string; asset: string }>>({});
  const [planDrafts, setPlanDrafts] = useState<Record<string, { label: string; allowance: string }>>({});
  const [addonDrafts, setAddonDrafts] = useState<Record<string, { label: string; price: string }>>({});

  // New-row forms
  const [newRate, setNewRate] = useState({ id: "", input: "", output: "", asset: "" });
  const [newPlan, setNewPlan] = useState({ id: "", label: "", allowance: "" });
  const [newAddon, setNewAddon] = useState({ label: "", price: "" });

  const load = useCallback(async () => {
    setLoading(true);
    const d = await getTokenBilling();
    setData(d);
    const rd: Record<string, { input: string; output: string; asset: string }> = {};
    for (const r of d.rates) {
      rd[r.model_identifier] = {
        input: r.input_per_1m_usd?.toString() ?? "",
        output: r.output_per_1m_usd?.toString() ?? "",
        asset: r.asset_price_usd?.toString() ?? "",
      };
    }
    setRateDrafts(rd);
    const pd: Record<string, { label: string; allowance: string }> = {};
    for (const p of d.plans) {
      pd[p.plan_id] = { label: p.label, allowance: p.monthly_token_allowance_usd?.toString() ?? "0" };
    }
    setPlanDrafts(pd);
    const ad: Record<string, { label: string; price: string }> = {};
    for (const a of d.addons) {
      ad[a.id] = { label: a.label, price: a.price_usd?.toString() ?? "" };
    }
    setAddonDrafts(ad);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const run = async (key: string, fn: () => Promise<{ ok: boolean; error?: string }>) => {
    setPending(key);
    setFeedback(null);
    const res = await fn();
    setPending(null);
    if (res.ok) {
      setFeedback({ type: "ok", msg: "Saved." });
      load();
    } else {
      setFeedback({ type: "err", msg: res.error ?? "Save failed." });
    }
  };

  const setRateDraft = (id: string, field: keyof ModelRate | "input" | "output" | "asset", v: string) =>
    setRateDrafts((p) => ({ ...p, [id]: { ...(p[id] ?? { input: "", output: "", asset: "" }), [field]: v } }));

  const setPlanDraft = (id: string, field: "label" | "allowance", v: string) =>
    setPlanDrafts((p) => ({ ...p, [id]: { ...(p[id] ?? { label: "", allowance: "" }), [field]: v } }));

  const setAddonDraft = (id: string, field: "label" | "price", v: string) =>
    setAddonDrafts((p) => ({ ...p, [id]: { ...(p[id] ?? { label: "", price: "" }), [field]: v } }));

  if (loading) {
    return (
      <Card>
        <CardContent className="py-8 flex items-center gap-2 text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Loading token billing…
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Coins className="size-5 text-primary" /> Token Billing
        </CardTitle>
        <CardDescription>
          Usage is billed per token per model (USD, input/output per 1M tokens;
          assets per call). Set each plan&apos;s monthly allowance and the
          add-on denominations (min $20). Adjust rates as provider pricing
          fluctuates.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-8">
        {feedback && (
          <div className={`p-2 rounded-md text-sm ${feedback.type === "ok" ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"}`}>
            {feedback.msg}
          </div>
        )}

        {/* ---- Plan allowances ---- */}
        <section className="space-y-3">
          <h3 className="text-sm font-semibold">Plan monthly token allowance (USD)</h3>
          {data.plans.length === 0 && (
            <p className="text-xs text-muted-foreground">No plans configured yet — add one by its Stripe plan/price id.</p>
          )}
          {data.plans.map((p: TokenPlan) => {
            const d = planDrafts[p.plan_id] ?? { label: p.label, allowance: String(p.monthly_token_allowance_usd) };
            return (
              <div key={p.plan_id} className="flex flex-wrap items-end gap-2 border-b pb-2">
                <div className="min-w-40">
                  <span className="text-[10px] uppercase text-muted-foreground">Plan id</span>
                  <div className="text-sm font-mono">{p.plan_id}</div>
                </div>
                <Input className="w-36" value={d.label} onChange={(e) => setPlanDraft(p.plan_id, "label", e.target.value)} placeholder="Label" />
                <div>
                  <span className="text-[10px] uppercase text-muted-foreground">$/month allowance</span>
                  <Input className="w-28" value={d.allowance} onChange={(e) => setPlanDraft(p.plan_id, "allowance", e.target.value)} placeholder="0.00" />
                </div>
                <Button size="sm" variant="secondary" disabled={pending !== null} onClick={() => run(p.plan_id, () => savePlan(p.plan_id, d.label, d.allowance))}>
                  <Save className="size-3.5 mr-1" /> Save
                </Button>
                <Button size="sm" variant="ghost" className="text-destructive" disabled={pending !== null} onClick={() => run(p.plan_id, () => deletePlan(p.plan_id))}>
                  <Trash2 className="size-3.5" />
                </Button>
              </div>
            );
          })}
          <div className="flex flex-wrap items-end gap-2 pt-1">
            <Input className="w-44" placeholder="plan_id (Stripe price id)" value={newPlan.id} onChange={(e) => setNewPlan({ ...newPlan, id: e.target.value })} />
            <Input className="w-32" placeholder="Label" value={newPlan.label} onChange={(e) => setNewPlan({ ...newPlan, label: e.target.value })} />
            <Input className="w-28" placeholder="Allowance $" value={newPlan.allowance} onChange={(e) => setNewPlan({ ...newPlan, allowance: e.target.value })} />
            <Button size="sm" disabled={pending !== null || !newPlan.id.trim()} onClick={() => run("new-plan", () => savePlan(newPlan.id, newPlan.label, newPlan.allowance).then((r) => { if (r.ok) setNewPlan({ id: "", label: "", allowance: "" }); return r; }))}>
              <Plus className="size-3.5 mr-1" /> Add plan
            </Button>
          </div>
        </section>

        {/* ---- Add-on denominations ---- */}
        <section className="space-y-3">
          <h3 className="text-sm font-semibold">Add-on token packs (USD, min $20)</h3>
          {data.addons.map((a: TokenAddon) => {
            const d = addonDrafts[a.id] ?? { label: a.label, price: String(a.price_usd) };
            return (
              <div key={a.id} className="flex flex-wrap items-center gap-2 border-b pb-2">
                <Badge variant={a.active ? "default" : "secondary"}>{a.active ? "Active" : "Inactive"}</Badge>
                <Input className="w-40" value={d.label} onChange={(e) => setAddonDraft(a.id, "label", e.target.value)} />
                <Input className="w-24" value={d.price} onChange={(e) => setAddonDraft(a.id, "price", e.target.value)} />
                <Button size="sm" variant="secondary" disabled={pending !== null} onClick={() => run(a.id, () => saveAddon(a.id, d.label, d.price, a.active))}>
                  <Save className="size-3.5 mr-1" /> Save
                </Button>
                <Button size="sm" variant="outline" disabled={pending !== null} onClick={() => run(a.id, () => saveAddon(a.id, d.label, d.price, !a.active))}>
                  Toggle active
                </Button>
                <Button size="sm" variant="ghost" className="text-destructive" disabled={pending !== null} onClick={() => run(a.id, () => deleteAddon(a.id))}>
                  <Trash2 className="size-3.5" />
                </Button>
              </div>
            );
          })}
          <div className="flex flex-wrap items-end gap-2 pt-1">
            <Input className="w-40" placeholder="Label (e.g. 20 USD)" value={newAddon.label} onChange={(e) => setNewAddon({ ...newAddon, label: e.target.value })} />
            <Input className="w-24" placeholder="Price $" value={newAddon.price} onChange={(e) => setNewAddon({ ...newAddon, price: e.target.value })} />
            <Button size="sm" disabled={pending !== null || !newAddon.price.trim()} onClick={() => run("new-addon", () => saveAddon(null, newAddon.label, newAddon.price, true).then((r) => { if (r.ok) setNewAddon({ label: "", price: "" }); return r; }))}>
              <Plus className="size-3.5 mr-1" /> Add add-on
            </Button>
          </div>
        </section>

        {/* ---- Model rates ---- */}
        <section className="space-y-3">
          <h3 className="text-sm font-semibold">Model rates (USD — per 1M tokens in/out; asset per call)</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground text-xs">
                  <th className="py-1.5 pr-3">Model</th>
                  <th className="py-1.5 pr-3 w-28">Input /1M</th>
                  <th className="py-1.5 pr-3 w-28">Output /1M</th>
                  <th className="py-1.5 pr-3 w-28">Asset</th>
                  <th className="py-1.5"></th>
                </tr>
              </thead>
              <tbody>
                {data.rates.map((r: ModelRate) => {
                  const d = rateDrafts[r.model_identifier] ?? { input: "", output: "", asset: "" };
                  return (
                    <tr key={r.model_identifier} className="border-b last:border-0">
                      <td className="py-1.5 pr-3 font-mono text-xs">{r.model_identifier}</td>
                      <td className="py-1.5 pr-3"><Input className="h-8 w-24" value={d.input} onChange={(e) => setRateDraft(r.model_identifier, "input", e.target.value)} /></td>
                      <td className="py-1.5 pr-3"><Input className="h-8 w-24" value={d.output} onChange={(e) => setRateDraft(r.model_identifier, "output", e.target.value)} /></td>
                      <td className="py-1.5 pr-3"><Input className="h-8 w-24" value={d.asset} onChange={(e) => setRateDraft(r.model_identifier, "asset", e.target.value)} /></td>
                      <td className="py-1.5">
                        <div className="flex gap-1">
                          <Button size="sm" variant="secondary" disabled={pending !== null} onClick={() => run(r.model_identifier, () => saveModelRate(r.model_identifier, d.input, d.output, d.asset))}>
                            <Save className="size-3.5" />
                          </Button>
                          <Button size="sm" variant="ghost" className="text-destructive" disabled={pending !== null} onClick={() => run(r.model_identifier, () => deleteModelRate(r.model_identifier))}>
                            <Trash2 className="size-3.5" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap items-end gap-2 pt-1">
            <Input className="w-52 font-mono" placeholder="model identifier" value={newRate.id} onChange={(e) => setNewRate({ ...newRate, id: e.target.value })} />
            <Input className="w-24" placeholder="In /1M" value={newRate.input} onChange={(e) => setNewRate({ ...newRate, input: e.target.value })} />
            <Input className="w-24" placeholder="Out /1M" value={newRate.output} onChange={(e) => setNewRate({ ...newRate, output: e.target.value })} />
            <Input className="w-24" placeholder="Asset" value={newRate.asset} onChange={(e) => setNewRate({ ...newRate, asset: e.target.value })} />
            <Button size="sm" disabled={pending !== null || !newRate.id.trim()} onClick={() => run("new-rate", () => saveModelRate(newRate.id, newRate.input, newRate.output, newRate.asset).then((r) => { if (r.ok) setNewRate({ id: "", input: "", output: "", asset: "" }); return r; }))}>
              <Plus className="size-3.5 mr-1" /> Add rate
            </Button>
          </div>
        </section>
      </CardContent>
    </Card>
  );
}
