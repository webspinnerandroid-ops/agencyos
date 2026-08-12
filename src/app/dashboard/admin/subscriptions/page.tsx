"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Loader2,
  Plus,
  Trash2,
  Pencil,
  RefreshCw,
  Wallet,
  CalendarClock,
  Link2,
} from "lucide-react";

interface Subscription {
  id: string;
  provider: string;
  purpose: string | null;
  plan: string | null;
  cost_per_cycle: number | null;
  billing_cycle: string;
  cycle_day: number | null;
  renewal_date: string | null;
  amount_owing: number | null;
  credit_remaining: number | null;
  portal_url: string | null;
  account_email: string | null;
  notes: string | null;
  auto_check: string | null;
  last_checked_at: string | null;
}

const EMPTY_FORM = {
  provider: "",
  purpose: "",
  plan: "",
  cost_per_cycle: "",
  billing_cycle: "monthly",
  cycle_day: "",
  renewal_date: "",
  amount_owing: "",
  credit_remaining: "",
  portal_url: "",
  account_email: "",
  notes: "",
  auto_check: "manual",
};

type FormState = typeof EMPTY_FORM;

const fmtMoney = (v: number | null) =>
  v == null ? "—" : `$${Number(v).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;

export default function SubscriptionsPage() {
  const [rows, setRows] = useState<Subscription[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [checking, setChecking] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/subscriptions", { credentials: "include" });
      const data = await res.json();
      if (!res.ok) {
        setFeedback({ type: "error", message: data.error ?? "Failed to load subscriptions" });
        return;
      }
      setRows(data.subscriptions ?? []);
    } catch (err: any) {
      setFeedback({ type: "error", message: err.message ?? "Failed to load subscriptions" });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const toForm = (s: Subscription): FormState => ({
    provider: s.provider,
    purpose: s.purpose ?? "",
    plan: s.plan ?? "",
    cost_per_cycle: s.cost_per_cycle != null ? String(s.cost_per_cycle) : "",
    billing_cycle: s.billing_cycle,
    cycle_day: s.cycle_day != null ? String(s.cycle_day) : "",
    renewal_date: s.renewal_date ?? "",
    amount_owing: s.amount_owing != null ? String(s.amount_owing) : "",
    credit_remaining: s.credit_remaining != null ? String(s.credit_remaining) : "",
    portal_url: s.portal_url ?? "",
    account_email: s.account_email ?? "",
    notes: s.notes ?? "",
    auto_check: s.auto_check ?? "manual",
  });

  const edit = (s: Subscription) => {
    setEditingId(s.id);
    setForm(toForm(s));
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const startAdd = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const submit = async () => {
    if (!form.provider.trim()) {
      setFeedback({ type: "error", message: "Provider name is required." });
      return;
    }
    setSaving(true);
    setFeedback(null);
    const payload = {
      ...form,
      cost_per_cycle: form.cost_per_cycle ? Number(form.cost_per_cycle) : null,
      cycle_day: form.cycle_day ? Number(form.cycle_day) : null,
      amount_owing: form.amount_owing ? Number(form.amount_owing) : null,
      credit_remaining: form.credit_remaining ? Number(form.credit_remaining) : null,
      renewal_date: form.renewal_date || null,
    };
    try {
      const res = await fetch("/api/admin/subscriptions", {
        method: editingId ? "PUT" : "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editingId ? { ...payload, id: editingId } : payload),
      });
      const data = await res.json();
      if (!res.ok) {
        setFeedback({ type: "error", message: data.error ?? "Failed to save" });
        return;
      }
      setFeedback({ type: "success", message: editingId ? "Subscription updated." : "Subscription added." });
      setEditingId(null);
      setForm(EMPTY_FORM);
      load();
    } catch (err: any) {
      setFeedback({ type: "error", message: err.message ?? "Failed to save" });
    } finally {
      setSaving(false);
    }
  };

  const checkOne = async (id: string) => {
    setChecking(id);
    setFeedback(null);
    try {
      const res = await fetch("/api/admin/subscriptions", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "check", id }),
      });
      const data = await res.json();
      if (!res.ok) {
        setFeedback({ type: "error", message: data.error ?? "Check failed" });
        return;
      }
      setFeedback({
        type: "success",
        message: `Checked — ${data.detail ?? "updated"}${
          data.creditRemaining != null ? ` · credit left: ${fmtMoney(data.creditRemaining)}` : ""
        }`,
      });
      load();
    } catch (err: any) {
      setFeedback({ type: "error", message: err.message ?? "Check failed" });
    } finally {
      setChecking(null);
    }
  };

  const checkAll = async () => {
    setChecking("all");
    setFeedback(null);
    try {
      const res = await fetch("/api/admin/subscriptions", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "checkAll" }),
      });
      const data = await res.json();
      if (!res.ok) {
        setFeedback({ type: "error", message: data.error ?? "Check failed" });
        return;
      }
      const ok = (data.results ?? []).filter((r: any) => r.ok).length;
      const bad = (data.results ?? []).filter((r: any) => !r.ok);
      setFeedback({
        type: bad.length ? "error" : "success",
        message: `Checked ${ok} provider(s)${bad.length ? `; ${bad.length} failed: ${bad.map((r: any) => `${r.provider} (${r.error ?? "error"})`).join(", ")}` : ""}.`,
      });
      load();
    } catch (err: any) {
      setFeedback({ type: "error", message: err.message ?? "Check failed" });
    } finally {
      setChecking(null);
    }
  };

  const remove = async (s: Subscription) => {
    if (!confirm(`Remove "${s.provider}" from the registry?`)) return;
    const res = await fetch(`/api/admin/subscriptions?id=${s.id}`, {
      method: "DELETE",
      credentials: "include",
    });
    if (res.ok) {
      setFeedback({ type: "success", message: "Removed." });
      load();
    } else {
      const data = await res.json().catch(() => ({}));
      setFeedback({ type: "error", message: data.error ?? "Failed to remove" });
    }
  };

  return (
    <div className="space-y-6 max-w-6xl">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
            <Wallet className="size-7 text-primary" /> APIs & Subscriptions
          </h1>
          <p className="text-muted-foreground mt-1">
            Every external service this system depends on — what it costs, when it renews,
            what&apos;s owing, and how much credit is left. Stripe and Resend auto-check;
            the rest update from their portals.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={checkAll} disabled={checking !== null}>
            {checking === "all" ? <Loader2 className="size-4 animate-spin mr-1" /> : <RefreshCw className="size-4 mr-1" />}
            Check balances
          </Button>
          <Button onClick={startAdd}>
            <Plus className="size-4 mr-1" /> Add subscription
          </Button>
        </div>
      </div>

      {feedback && (
        <div className={`p-3 rounded-md text-sm border ${feedback.type === "success" ? "bg-green-50 text-green-700 border-green-200" : "bg-red-50 text-red-700 border-red-200"}`} role="alert">
          {feedback.message}
          <button className="ml-3 underline text-xs" onClick={() => setFeedback(null)}>Dismiss</button>
        </div>
      )}

      {/* Add / edit form */}
      <Card className="p-5">
        <h2 className="text-lg font-semibold mb-4">{editingId ? "Edit subscription" : "Add subscription"}</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="space-y-1">
            <Label>Provider *</Label>
            <Input value={form.provider} onChange={(e) => setForm({ ...form, provider: e.target.value })} placeholder="e.g. OpenAI" />
          </div>
          <div className="space-y-1">
            <Label>Purpose</Label>
            <Input value={form.purpose} onChange={(e) => setForm({ ...form, purpose: e.target.value })} placeholder="What it powers" />
          </div>
          <div className="space-y-1">
            <Label>Plan</Label>
            <Input value={form.plan} onChange={(e) => setForm({ ...form, plan: e.target.value })} placeholder="e.g. Pro" />
          </div>
          <div className="space-y-1">
            <Label>Cost per cycle ($)</Label>
            <Input type="number" step="0.01" value={form.cost_per_cycle} onChange={(e) => setForm({ ...form, cost_per_cycle: e.target.value })} placeholder="49.00" />
          </div>
          <div className="space-y-1">
            <Label>Billing cycle</Label>
            <select
              value={form.billing_cycle}
              onChange={(e) => setForm({ ...form, billing_cycle: e.target.value })}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
            >
              <option value="monthly">Monthly</option>
              <option value="annual">Annual</option>
              <option value="payg">Pay-as-you-go</option>
            </select>
          </div>
          <div className="space-y-1">
            <Label>Renews on day</Label>
            <Input type="number" min={1} max={31} value={form.cycle_day} onChange={(e) => setForm({ ...form, cycle_day: e.target.value })} placeholder="1–31" />
          </div>
          <div className="space-y-1">
            <Label>Next renewal (due)</Label>
            <Input type="date" value={form.renewal_date} onChange={(e) => setForm({ ...form, renewal_date: e.target.value })} />
          </div>
          <div className="space-y-1">
            <Label>Amount owing ($)</Label>
            <Input type="number" step="0.01" value={form.amount_owing} onChange={(e) => setForm({ ...form, amount_owing: e.target.value })} placeholder="0.00" />
          </div>
          <div className="space-y-1">
            <Label>Credit / balance left</Label>
            <Input type="number" step="0.01" value={form.credit_remaining} onChange={(e) => setForm({ ...form, credit_remaining: e.target.value })} placeholder="0.00" />
          </div>
          <div className="space-y-1">
            <Label>Auto-check</Label>
            <select
              value={form.auto_check}
              onChange={(e) => setForm({ ...form, auto_check: e.target.value })}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
            >
              <option value="manual">Manual</option>
              <option value="stripe">Stripe (balance)</option>
              <option value="resend">Resend (email quota)</option>
            </select>
          </div>
          <div className="space-y-1">
            <Label>Portal URL</Label>
            <Input value={form.portal_url} onChange={(e) => setForm({ ...form, portal_url: e.target.value })} placeholder="https://…" />
          </div>
          <div className="space-y-1">
            <Label>Account email</Label>
            <Input value={form.account_email} onChange={(e) => setForm({ ...form, account_email: e.target.value })} placeholder="billing@…" />
          </div>
          <div className="space-y-1 sm:col-span-2 lg:col-span-4">
            <Label>Notes</Label>
            <Input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Anything worth remembering about this subscription" />
          </div>
        </div>
        <div className="flex items-center gap-2 mt-4">
          <Button onClick={submit} disabled={saving}>
            {saving ? <Loader2 className="size-4 animate-spin mr-1" /> : null}
            {editingId ? "Save changes" : "Add subscription"}
          </Button>
          {editingId && (
            <Button variant="ghost" onClick={() => { setEditingId(null); setForm(EMPTY_FORM); }}>Cancel</Button>
          )}
        </div>
      </Card>

      {/* Table */}
      {loading && !rows ? (
        <div className="flex items-center justify-center py-24 text-muted-foreground">
          <Loader2 className="size-8 animate-spin mr-3" /> Loading subscriptions…
        </div>
      ) : (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="py-3 px-3 font-medium">Provider</th>
                  <th className="py-3 px-3 font-medium">Purpose</th>
                  <th className="py-3 px-3 font-medium text-right">Cost</th>
                  <th className="py-3 px-3 font-medium">Due</th>
                  <th className="py-3 px-3 font-medium text-right">Owing</th>
                  <th className="py-3 px-3 font-medium text-right">Credit left</th>
                  <th className="py-3 px-3 font-medium">Checked</th>
                  <th className="py-3 px-3 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {(rows ?? []).map((s) => (
                  <tr key={s.id} className="border-b last:border-0 hover:bg-muted/30">
                    <td className="py-3 px-3">
                      <div className="font-medium">{s.provider}</div>
                      <div className="text-xs text-muted-foreground">{s.plan ?? ""}</div>
                    </td>
                    <td className="py-3 px-3 text-muted-foreground max-w-[220px]">{s.purpose ?? "—"}</td>
                    <td className="py-3 px-3 text-right whitespace-nowrap">
                      {fmtMoney(s.cost_per_cycle)}
                      {s.cost_per_cycle != null && s.billing_cycle !== "payg" && (
                        <span className="text-[10px] text-muted-foreground">/{s.billing_cycle === "annual" ? "yr" : "mo"}</span>
                      )}
                    </td>
                    <td className="py-3 px-3 whitespace-nowrap">
                      {s.renewal_date ? (
                        <span className="inline-flex items-center gap-1">
                          <CalendarClock className="size-3.5 text-muted-foreground" />
                          {new Date(s.renewal_date + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                        </span>
                      ) : s.cycle_day ? (
                        <span className="text-muted-foreground">Day {s.cycle_day} {s.billing_cycle === "annual" ? "(yr)" : "monthly"}</span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="py-3 px-3 text-right whitespace-nowrap">
                      {s.amount_owing != null && s.amount_owing > 0 ? (
                        <span className="text-red-600 font-medium">{fmtMoney(s.amount_owing)}</span>
                      ) : (
                        <span className="text-muted-foreground">{fmtMoney(s.amount_owing)}</span>
                      )}
                    </td>
                    <td className="py-3 px-3 text-right whitespace-nowrap">
                      {s.credit_remaining != null ? (
                        <span className="text-green-600 font-medium">{fmtMoney(s.credit_remaining)}</span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="py-3 px-3 text-xs text-muted-foreground whitespace-nowrap">
                      {s.last_checked_at
                        ? new Date(s.last_checked_at).toLocaleDateString("en-US", { month: "short", day: "numeric" }) +
                          " " + new Date(s.last_checked_at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
                        : "never"}
                    </td>
                    <td className="py-3 px-3">
                      <div className="flex items-center gap-0.5 justify-end">
                        {s.auto_check && s.auto_check !== "manual" && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => checkOne(s.id)}
                            disabled={checking !== null}
                            title={`Auto-check (${s.auto_check})`}
                          >
                            {checking === s.id ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
                          </Button>
                        )}
                        <Button variant="ghost" size="sm" onClick={() => edit(s)} title="Edit"><Pencil className="size-3.5" /></Button>
                        <Button variant="ghost" size="sm" className="text-destructive" onClick={() => remove(s)} title="Remove"><Trash2 className="size-3.5" /></Button>
                      </div>
                    </td>
                  </tr>
                ))}
                {(rows ?? []).length === 0 && (
                  <tr>
                    <td colSpan={8} className="py-10 text-center text-muted-foreground">
                      No subscriptions recorded yet — add the services you pay for.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <p className="text-xs text-muted-foreground flex items-center gap-1">
        <Link2 className="size-3" />
        Portal links are stored per row (edit any row to set one). Auto-check needs the server env keys: STRIPE_SECRET_KEY and RESEND_API_KEY.
      </p>
    </div>
  );
}
