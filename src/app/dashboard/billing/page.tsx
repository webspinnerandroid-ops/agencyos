"use client";

import { useEffect, useState, useCallback } from "react";

// ------------------------------------------------------------------
// Types
// ------------------------------------------------------------------

interface PlanLimits {
  ai_tokens?: number;
  social_profiles?: number;
  blog_posts?: number;
  social_posts?: number;
  image_generations?: number;
  video_generations?: number;
}

interface SubscriptionInfo {
  planId: string;
  planName: string;
  status: string;
  currentPeriodEnd: string | null;
  createdAt: string;
  features: string[];
  limits: PlanLimits;
}

interface UsageMetric {
  metric: string;
  count: number;
}

interface Invoice {
  id: string;
  amount: number;
  currency: string;
  status: string;
  date: string;
  pdfUrl: string | null;
}

interface HubInfo {
  id: string;
  name: string;
  tagline: string;
  features: string[];
  price: number;
  active: boolean;
}

interface TokenAddon {
  id: string;
  label: string;
  price_usd: number;
}

interface TokenBalanceInfo {
  enforced: boolean;
  monthlyAllowanceUsd: number;
  usedThisCycleUsd: number;
  addonBalanceUsd: number;
  remainingUsd: number;
}

interface BillingData {
  subscription: SubscriptionInfo | null;
  usage: UsageMetric[];
  invoices: Invoice[];
  hubs: HubInfo[];
  hubBundlePrice: number;
  tokenAddons: TokenAddon[];
  tokenBalance: TokenBalanceInfo | null;
}

const PLANS = [
  { id: "foundation", name: "Foundation", price: "$49/mo" },
  { id: "growth", name: "Growth", price: "$99/mo" },
  { id: "dominance", name: "Dominance", price: "$299/mo" },
] as const;

// ------------------------------------------------------------------
// Helpers
// ------------------------------------------------------------------

function formatCurrency(cents: number, currency: string): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
  }).format(cents / 100);
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function metricLabel(metric: string): string {
  switch (metric) {
    case "ai_tokens":
      return "AI Tokens";
    case "social_profiles":
      return "Social Profiles";
    case "blog_posts":
      return "Blog Posts";
    case "social_posts":
      return "Social Posts";
    default:
      return metric.replace(/_/g, " ");
  }
}

function metricLimit(metric: string, limits: PlanLimits): number | null {
  switch (metric) {
    case "ai_tokens":
      return limits.ai_tokens ?? null;
    case "social_profiles":
      return limits.social_profiles ?? null;
    case "blog_posts":
      return limits.blog_posts ?? null;
    case "social_posts":
      return limits.social_posts ?? null;
    case "image_generations":
      return limits.image_generations ?? null;
    case "video_generations":
      return limits.video_generations ?? null;
    default:
      return null;
  }
}

// ------------------------------------------------------------------
// Skeleton loader
// ------------------------------------------------------------------

function Skeleton({ className }: { className?: string }) {
  return (
    <div
      className={`animate-pulse rounded-md bg-muted ${className ?? ""}`}
    />
  );
}

// ------------------------------------------------------------------
// Page
// ------------------------------------------------------------------

export default function BillingPage() {
  const [data, setData] = useState<BillingData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [checkoutLoading, setCheckoutLoading] = useState<string | null>(null);
  const [portalLoading, setPortalLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  // Coupon code (super-admin-issued) applied at checkout.
  const [couponCode, setCouponCode] = useState("");
  // Hubs selected for the any-3 bundle (exactly 3).
  const [bundleHubs, setBundleHubs] = useState<string[]>([]);

  const fetchBilling = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch("/api/billing", { credentials: "include" });
      if (!res.ok) {
        const msg = await res.json().then((j) => j.error).catch(() => "Failed to load billing data");
        throw new Error(msg);
      }
      const json = (await res.json()) as BillingData;
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchBilling();
  }, [fetchBilling]);

  // Check for success/canceled query params after Stripe redirect
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("success") === "true") {
      setStatusMessage("Subscription successful! Welcome aboard.");
      // Clean the URL
      window.history.replaceState({}, "", "/dashboard/billing");
      fetchBilling();
    } else if (params.get("canceled") === "true") {
      setStatusMessage("Checkout was canceled. No changes were made.");
      window.history.replaceState({}, "", "/dashboard/billing");
    }
  }, [fetchBilling]);

  // ------------------------------------------------------------------
  // Upgrade handler
  // ------------------------------------------------------------------
  async function handleUpgrade(planId: string) {
    try {
      setCheckoutLoading(planId);
      const res = await fetch("/api/billing", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planId, couponCode: couponCode.trim() || undefined }),
      });

      if (!res.ok) {
        const msg = await res.json().then((j) => j.error).catch(() => "Failed to create checkout session");
        throw new Error(msg);
      }

      const { url } = (await res.json()) as { url: string };
      if (url) {
        window.location.href = url;
      } else {
        throw new Error("No checkout URL returned");
      }
    } catch (err) {
      setStatusMessage(
        err instanceof Error ? err.message : "Failed to start checkout"
      );
    } finally {
      setCheckoutLoading(null);
    }
  }

  // ------------------------------------------------------------------
  // Hub checkout (hub-and-spoke): add one hub, or the any-3 bundle.
  // ------------------------------------------------------------------
  async function handleHubCheckout(hubId: string) {
    try {
      setCheckoutLoading(hubId);
      const res = await fetch("/api/billing", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hubId, couponCode: couponCode.trim() || undefined }),
      });
      if (!res.ok) {
        const msg = await res.json().then((j) => j.error).catch(() => "Failed to start hub checkout");
        throw new Error(msg);
      }
      const { url } = (await res.json()) as { url: string };
      window.location.href = url;
    } catch (err) {
      setStatusMessage(err instanceof Error ? err.message : "Failed to start hub checkout");
    } finally {
      setCheckoutLoading(null);
    }
  }

  // ------------------------------------------------------------------
  // Token top-up checkout (one-off Stripe payment for prepaid balance)
  // ------------------------------------------------------------------
  async function handleTopupCheckout(addonId: string) {
    try {
      setCheckoutLoading("topup_" + addonId);
      const res = await fetch("/api/billing/topup", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ addonId }),
      });
      if (!res.ok) {
        const msg = await res.json().then((j) => j.error).catch(() => "Failed to start top-up checkout");
        throw new Error(msg);
      }
      const { url } = (await res.json()) as { url: string };
      window.location.href = url;
    } catch (err) {
      setStatusMessage(err instanceof Error ? err.message : "Failed to start top-up checkout");
    } finally {
      setCheckoutLoading(null);
    }
  }

  async function handleBundleCheckout() {
    if (bundleHubs.length !== 3) return;
    try {
      setCheckoutLoading("bundle");
      const res = await fetch("/api/billing", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bundle: "any_3", hubIds: bundleHubs, couponCode: couponCode.trim() || undefined }),
      });
      if (!res.ok) {
        const msg = await res.json().then((j) => j.error).catch(() => "Failed to start bundle checkout");
        throw new Error(msg);
      }
      const { url } = (await res.json()) as { url: string };
      window.location.href = url;
    } catch (err) {
      setStatusMessage(err instanceof Error ? err.message : "Failed to start bundle checkout");
    } finally {
      setCheckoutLoading(null);
    }
  }

  // ------------------------------------------------------------------
  // Stripe Customer Portal: manage subscription / payment method
  // ------------------------------------------------------------------
  async function handlePortal() {
    try {
      setPortalLoading(true);
      const res = await fetch("/api/billing", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "portal" }),
      });

      const json = (await res.json().catch(() => null)) as { url?: string; error?: string } | null;

      if (!res.ok || !json?.url) {
        throw new Error(json?.error ?? "Failed to open billing portal");
      }

      window.location.href = json.url;
    } catch (err) {
      setStatusMessage(
        err instanceof Error ? err.message : "Failed to open billing portal"
      );
    } finally {
      setPortalLoading(false);
    }
  }

  // ------------------------------------------------------------------
  // Loading state
  // ------------------------------------------------------------------
  if (loading) {
    return (
      <div className="space-y-8 animate-in fade-in">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Billing</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Manage your subscription and view usage
          </p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {[1, 2, 3].map((i) => (
            <div key={i} className="rounded-lg border p-6 space-y-4">
              <Skeleton className="h-5 w-24" />
              <Skeleton className="h-10 w-32" />
              <Skeleton className="h-4 w-full" />
            </div>
          ))}
        </div>
        <div className="rounded-lg border p-6">
          <Skeleton className="h-6 w-32 mb-4" />
          <Skeleton className="h-48 w-full" />
        </div>
      </div>
    );
  }

  // ------------------------------------------------------------------
  // Error state
  // ------------------------------------------------------------------
  if (error) {
    return (
      <div className="space-y-4 animate-in fade-in">
        <h1 className="text-2xl font-bold tracking-tight">Billing</h1>
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-6">
          <p className="text-sm text-destructive font-medium">Failed to load billing data</p>
          <p className="text-xs text-muted-foreground mt-1">{error}</p>
          <button
            onClick={fetchBilling}
            className="mt-4 inline-flex items-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  // ------------------------------------------------------------------
  // Data
  // ------------------------------------------------------------------
  const { subscription, usage, invoices } = data!;

  // Plans genuinely higher than the current tier (unknown/custom tiers like
  // "enterprise" are treated as top tier — never show downgrades).
  const currentPlanIndex = subscription
    ? PLANS.findIndex((pp) => pp.id === subscription.planId)
    : -1;
  const upgradePlans =
    currentPlanIndex >= 0 ? PLANS.slice(currentPlanIndex + 1) : [];

  return (
    <div className="space-y-8 animate-in fade-in">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Billing</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Manage your subscription, view usage, and download invoices
        </p>
      </div>

      {/* Status message banner */}
      {statusMessage && (
        <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800 dark:border-blue-900 dark:bg-blue-950 dark:text-blue-200">
          {statusMessage}
          <button
            onClick={() => setStatusMessage(null)}
            className="ml-2 font-medium underline"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Coupon code — super-admin-issued discount applied at checkout */}
      <section className="rounded-lg border bg-card p-5">
        <h2 className="text-sm font-semibold mb-1">Have a coupon code?</h2>
        <p className="text-xs text-muted-foreground mb-3">
          Enter a code issued by your provider and it will be applied automatically when you
          upgrade or subscribe below.
        </p>
        <div className="flex gap-2 max-w-sm">
          <input
            value={couponCode}
            onChange={(e) => setCouponCode(e.target.value.toUpperCase())}
            placeholder="e.g. SUMMER30"
            className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm uppercase"
          />
          <button
            onClick={() => setCouponCode("")}
            disabled={!couponCode}
            className="inline-flex items-center rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm hover:bg-accent disabled:opacity-40"
          >
            Clear
          </button>
        </div>
        {couponCode && (
          <p className="text-xs text-muted-foreground mt-2">
            "{couponCode}" will be applied to the next checkout. Invalid or expired codes are
            rejected before payment starts.
          </p>
        )}
      </section>

      {/* Current Plan Card */}
      <section>
        <h2 className="text-lg font-semibold mb-4">Current Plan</h2>
        <div className="rounded-lg border bg-card p-6">
          {subscription ? (
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div>
                <div className="flex items-center gap-3">
                  <h3 className="text-xl font-bold">{subscription.planName}</h3>
                  <span
                    className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
                      subscription.status === "active"
                        ? "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200"
                        : subscription.status === "canceled"
                          ? "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200"
                          : "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200"
                    }`}
                  >
                    {subscription.status}
                  </span>
                </div>
                {subscription.currentPeriodEnd && (
                  <p className="text-sm text-muted-foreground mt-1">
                    Current period ends: {formatDate(subscription.currentPeriodEnd)}
                  </p>
                )}
                {subscription.features.length > 0 && (
                  <ul className="mt-3 space-y-1">
                    {subscription.features.map((f) => (
                      <li key={f} className="flex items-center gap-2 text-sm text-muted-foreground">
                        <svg className="h-4 w-4 text-green-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                        </svg>
                        {f}
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {/* Manage subscription / payment method */}
              <div className="flex flex-col gap-2 min-w-[180px]">
                <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">
                  Manage
                </p>
                <button
                  onClick={handlePortal}
                  disabled={portalLoading}
                  className="w-full inline-flex items-center justify-center rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
                >
                  {portalLoading ? "Opening…" : "Manage subscription & payment"}
                </button>
              </div>

              {/* Show upgrade options only for genuinely higher tiers */}
              {upgradePlans.length > 0 && (
                <div className="flex flex-col gap-2 min-w-[180px]">
                  <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">
                    Upgrade
                  </p>
                  {upgradePlans.map((plan) => (
                    <button
                      key={plan.id}
                      onClick={() => handleUpgrade(plan.id)}
                      disabled={checkoutLoading === plan.id}
                      className="w-full inline-flex items-center justify-center rounded-md border border-input bg-background px-3 py-2 text-sm font-medium shadow-sm hover:bg-accent hover:text-accent-foreground disabled:opacity-50 transition-colors"
                    >
                      {checkoutLoading === plan.id ? (
                        <>
                          <svg
                            className="mr-2 h-4 w-4 animate-spin"
                            xmlns="http://www.w3.org/2000/svg"
                            fill="none"
                            viewBox="0 0 24 24"
                          >
                            <circle
                              className="opacity-25"
                              cx="12"
                              cy="12"
                              r="10"
                              stroke="currentColor"
                              strokeWidth="4"
                            />
                            <path
                              className="opacity-75"
                              fill="currentColor"
                              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                            />
                          </svg>
                          Loading…
                        </>
                      ) : (
                        <>
                          Switch to {plan.name} ({plan.price})
                        </>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div>
              <p className="text-muted-foreground mb-4">
                You are not currently subscribed to a plan.
              </p>
              <div className="flex flex-wrap gap-3">
                {PLANS.map((plan) => (
                  <button
                    key={plan.id}
                    onClick={() => handleUpgrade(plan.id)}
                    disabled={checkoutLoading === plan.id}
                    className="inline-flex items-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
                  >
                    {checkoutLoading === plan.id ? "Loading…" : `Subscribe to ${plan.name} (${plan.price})`}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </section>

      {/* Hubs — hub-and-spoke a-la-carte add-ons */}
      <section>
        <div className="flex items-center justify-between gap-3 flex-wrap mb-4">
          <div>
            <h2 className="text-lg font-semibold">Hubs (a la carte)</h2>
            <p className="text-sm text-muted-foreground mt-0.5">
              Buy just the piece you need, or take an all-in-one tier above to get
              everything at higher limits. Hub allowances add up each month.
            </p>
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {data!.hubs.map((hub) => (
            <div
              key={hub.id}
              className={`rounded-lg border bg-card p-5 flex flex-col ${hub.active ? "border-green-300 dark:border-green-800" : ""}`}
            >
              <div className="flex items-start justify-between gap-2">
                <h3 className="font-semibold">{hub.name}</h3>
                {hub.active ? (
                  <span className="inline-flex items-center rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800 dark:bg-green-900 dark:text-green-200">
                    Active
                  </span>
                ) : (
                  <span className="text-sm font-semibold">${hub.price}/mo</span>
                )}
              </div>
              <p className="text-xs text-muted-foreground mt-1">{hub.tagline}</p>
              <ul className="mt-3 space-y-1 flex-1">
                {hub.features.map((f) => (
                  <li key={f} className="flex items-start gap-2 text-xs text-muted-foreground">
                    <svg className="h-3.5 w-3.5 text-green-500 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                    {f}
                  </li>
                ))}
              </ul>
              {!hub.active && (
                <button
                  onClick={() => handleHubCheckout(hub.id)}
                  disabled={checkoutLoading === hub.id || !!data!.subscription}
                  className="mt-4 inline-flex items-center justify-center rounded-md border border-input bg-background px-3 py-2 text-sm font-medium shadow-sm hover:bg-accent hover:text-accent-foreground disabled:opacity-40 transition-colors"
                  title={
                    data!.subscription
                      ? "You're on an all-in-one tier — every hub is already included."
                      : `Add ${hub.name} for $${hub.price}/mo`
                  }
                >
                  {checkoutLoading === hub.id ? "Loading…" : data!.subscription ? "Included in your tier" : `Add ${hub.name} — $${hub.price}/mo`}
                </button>
              )}
            </div>
          ))}
        </div>

        {/* Any-3 bundle */}
        {!data!.subscription && (
          <div className="mt-4 rounded-lg border bg-muted/30 p-4">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div>
                <h3 className="text-sm font-semibold">Bundle: any 3 hubs</h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Pick three hubs and pay ${data!.hubBundlePrice}/mo instead of ${(data!.hubs[0]?.price ?? 29) * 3}/mo.
                </p>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {data!.hubs.map((hub) => {
                  const selected = bundleHubs.includes(hub.id);
                  const disabled = !selected && bundleHubs.length >= 3;
                  return (
                    <button
                      key={hub.id}
                      onClick={() =>
                        setBundleHubs((prev) =>
                          selected
                            ? prev.filter((h) => h !== hub.id)
                            : prev.length < 3
                              ? [...prev, hub.id]
                              : prev
                        )
                      }
                      disabled={disabled || hub.active}
                      className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-medium transition-colors disabled:opacity-40 ${
                        selected
                          ? "border-primary bg-primary/10 text-primary"
                          : "bg-background hover:bg-accent"
                      }`}
                    >
                      {hub.active ? "✓ " : ""}{hub.name}
                    </button>
                  );
                })}
              </div>
              <button
                onClick={handleBundleCheckout}
                disabled={bundleHubs.length !== 3 || checkoutLoading === "bundle"}
                className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-40 transition-colors"
              >
                {checkoutLoading === "bundle" ? "Loading…" : `Get 3 hubs for $${data!.hubBundlePrice}/mo`}
              </button>
            </div>
          </div>
        )}
      </section>

      {/* Token Top-Up — prepaid AI balance (min $20 USD) */}
      <section>
        <div className="flex items-center justify-between gap-3 flex-wrap mb-4">
          <div>
            <h2 className="text-lg font-semibold">AI Token Balance</h2>
            <p className="text-sm text-muted-foreground mt-0.5">
              Usage is billed per token per model. Your monthly allowance is
              used first; when it runs out, generation pauses until you add
              prepaid tokens (min $20 USD).
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
          <div className="rounded-lg border bg-card p-4">
            <p className="text-sm font-medium text-muted-foreground">Monthly allowance</p>
            <p className="text-2xl font-bold tracking-tight">${(data!.tokenBalance?.monthlyAllowanceUsd ?? 0).toFixed(2)}</p>
          </div>
          <div className="rounded-lg border bg-card p-4">
            <p className="text-sm font-medium text-muted-foreground">Used this cycle</p>
            <p className="text-2xl font-bold tracking-tight">${(data!.tokenBalance?.usedThisCycleUsd ?? 0).toFixed(2)}</p>
          </div>
          <div className="rounded-lg border bg-card p-4">
            <p className="text-sm font-medium text-muted-foreground">Prepaid balance</p>
            <p className="text-2xl font-bold tracking-tight">${(data!.tokenBalance?.addonBalanceUsd ?? 0).toFixed(2)}</p>
          </div>
        </div>

        {data!.tokenAddons.length > 0 ? (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
            {data!.tokenAddons.map((addon) => (
              <div key={addon.id} className="rounded-lg border bg-card p-4 flex flex-col items-center text-center gap-2">
                <span className="text-2xl font-bold">${addon.price_usd.toFixed(2)}</span>
                <span className="text-xs text-muted-foreground">{addon.label}</span>
                <button
                  onClick={() => handleTopupCheckout(addon.id)}
                  disabled={checkoutLoading === "topup_" + addon.id}
                  className="mt-1 inline-flex items-center justify-center rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-40 transition-colors"
                >
                  {checkoutLoading === "topup_" + addon.id ? "Loading…" : "Add tokens"}
                </button>
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
            No add-on packs configured yet — the super admin can set them on the Admin page.
          </div>
        )}
      </section>

      {/* Usage Section */}
      <section>
        <h2 className="text-lg font-semibold mb-4">Usage (Current Month)</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {["ai_tokens", "social_profiles", "blog_posts", "social_posts"].map(
            (metric) => {
              const usageItem = usage.find((u) => u.metric === metric);
              const count = usageItem?.count ?? 0;
              const limit = subscription
                ? metricLimit(metric, subscription.limits)
                : null;
              const pct = limit && limit > 0 ? Math.min((count / limit) * 100, 100) : 0;

              return (
                <div
                  key={metric}
                  className="rounded-lg border bg-card p-4 space-y-3"
                >
                  <p className="text-sm font-medium text-muted-foreground">
                    {metricLabel(metric)}
                  </p>
                  <p className="text-3xl font-bold tracking-tight">
                    {count.toLocaleString()}
                  </p>
                  {limit !== null && (
                    <div className="space-y-1.5">
                      <div className="h-2 w-full rounded-full bg-secondary overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all duration-500 ${
                            pct > 90
                              ? "bg-red-500"
                              : pct > 70
                                ? "bg-yellow-500"
                                : "bg-green-500"
                          }`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {count.toLocaleString()} / {limit.toLocaleString()}{" "}
                        {limit > 0 ? `(${Math.round(pct)}%)` : ""}
                      </p>
                    </div>
                  )}
                </div>
              );
            }
          )}
        </div>
      </section>

      {/* Billing History */}
      <section>
        <h2 className="text-lg font-semibold mb-4">Billing History</h2>
        <div className="rounded-lg border bg-card overflow-hidden">
          {invoices.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                      Date
                    </th>
                    <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                      Amount
                    </th>
                    <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                      Status
                    </th>
                    <th className="px-4 py-3 text-right font-medium text-muted-foreground">
                      Receipt
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {invoices.map((inv) => (
                    <tr key={inv.id} className="border-b last:border-0 hover:bg-muted/30 transition-colors">
                      <td className="px-4 py-3 whitespace-nowrap">
                        {formatDate(inv.date)}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap font-medium">
                        {formatCurrency(inv.amount, inv.currency)}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span
                          className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                            inv.status === "paid"
                              ? "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200"
                              : inv.status === "open"
                                ? "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200"
                                : "bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200"
                          }`}
                        >
                          {inv.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        {inv.pdfUrl ? (
                          <a
                            href={inv.pdfUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-primary hover:underline font-medium"
                          >
                            Download
                          </a>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="px-6 py-12 text-center">
              <p className="text-muted-foreground text-sm">
                No billing history yet. Your invoices will appear here after your first payment.
              </p>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}