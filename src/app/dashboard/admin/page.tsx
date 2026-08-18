"use client";

import { Fragment, useCallback, useEffect, useState, useTransition } from "react";
import { createBrowserClient } from "@supabase/ssr";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Loader2, Building2, Users, FileText, Key, TrendingUp, Shield, X, UserCog, Menu, Wallet, LayoutTemplate, LogIn, Image as ImageIcon } from "lucide-react";
import { getDashboardStats, getAllTenants, getLicenses, getLicenseAudit, issueLicense, updateLicensePlan, renewLicense, revokeLicense, deleteLicense, deleteUser, deleteTenant, getAllUsers, assignLevel, grantHub, revokeHub, getAdminAudit, getAssetHealth, getBrokenAssets, deleteAsset, regenerateAsset, setLicenseTrial, type TenantSummary, type LicenseRecord, type LicenseAuditEntry, type AdminAuditEntry, type UserRecord, type BrokenAsset } from "./actions";
import type { WorkspaceAssetHealth } from "@/lib/asset-health";
import { formatBytes } from "@/lib/asset-health";
import TokenBilling from "./token-billing";

// Hub-and-spoke add-ons the super admin can grant/revoke without payment.
const HUBS = [
  { id: "content", name: "Content" },
  { id: "social", name: "Social" },
  { id: "video", name: "Video" },
  { id: "website", name: "Website" },
  { id: "outreach", name: "Outreach" },
  { id: "ai_team", name: "AI Team" },
];

const PLANS = [
  { id: "starter", name: "Starter" },
  { id: "growth", name: "Growth" },
  { id: "enterprise", name: "Enterprise" },
];

const LEVELS = [
  { id: "client", name: "User / Client" },
  { id: "agency_editor", name: "Editor" },
  { id: "agency_admin", name: "Admin" },
  { id: "super_admin", name: "Super Admin" },
];

function levelLabel(role: string) {
  const lvl = LEVELS.find(l => l.id === role);
  if (role === "client") return "User / Client";
  return lvl?.name ?? role;
}

function actionLabel(action: string): string {
  const map: Record<string, string> = {
    user_deleted: "User deleted",
    blocked_user_delete: "User delete blocked",
    tenant_deleted: "Tenant deleted",
    blocked_tenant_delete: "Tenant delete blocked",
    role_changed: "Role changed",
    role_assigned: "Role assigned",
    blocked_role_change: "Role change blocked",
    hub_granted: "Hub granted",
    hub_revoked: "Hub revoked",
    license_deleted: "License deleted",
    blocked_signup: "Disposable signup blocked",
    workspace_member_granted: "Workspace access granted",
    workspace_member_revoked: "Workspace access revoked",
  };
  return map[action] ?? action;
}

function auditBadgeClass(action: string): string {
  if (action.startsWith("blocked_")) return "bg-red-100 text-red-700";
  if (action.includes("deleted")) return "bg-orange-100 text-orange-700";
  if (action.includes("role")) return "bg-blue-100 text-blue-700";
  if (action.includes("hub")) return "bg-purple-100 text-purple-700";
  if (action.includes("workspace")) return "bg-teal-100 text-teal-700";
  return "bg-gray-100 text-gray-700";
}

function statusColor(s: string | null) {
  if (s === "active") return "bg-green-100 text-green-700";
  if (s === "trialing") return "bg-blue-100 text-blue-700";
  if (s === "past_due") return "bg-yellow-100 text-yellow-700";
  return "bg-gray-100 text-gray-600";
}

export default function AdminDashboardPage() {
  const [stats, setStats] = useState<any>(null);
  const [tenants, setTenants] = useState<TenantSummary[]>([]);
  const [licenses, setLicenses] = useState<LicenseRecord[]>([]);
  const [users, setUsers] = useState<UserRecord[]>([]);
  const [audit, setAudit] = useState<AdminAuditEntry[]>([]);
  const [feedback, setFeedback] = useState<{ type: string; message: string } | null>(null);
  const [isLoading, startLoading] = useTransition();
  const [isPending, startTransition] = useTransition();
  const [showForm, setShowForm] = useState(false);
  const [auditFor, setAuditFor] = useState<Record<string, LicenseAuditEntry[]>>({});
  const [expandedAudit, setExpandedAudit] = useState<string | null>(null);
  const [assetHealth, setAssetHealth] = useState<WorkspaceAssetHealth[] | null>(null);
  const [healthLoading, setHealthLoading] = useState(false);

  const loadAssetHealth = useCallback(() => {
    setHealthLoading(true);
    getAssetHealth().then((r) => {
      if (r.success) setAssetHealth(r.data ?? []);
      setHealthLoading(false);
    });
  }, []);

  // Non-blocking: byte-checks every CDN asset, so run it after first paint.
  useEffect(() => { void loadAssetHealth(); }, [loadAssetHealth]);

  const [expandedHealth, setExpandedHealth] = useState<string | null>(null);
  const [brokenAssets, setBrokenAssets] = useState<Record<string, BrokenAsset[]>>({});
  const [brokenLoading, setBrokenLoading] = useState<Record<string, boolean>>({});

  const toggleHealthRow = (key: string) => {
    const next = expandedHealth === key ? null : key;
    setExpandedHealth(next);
    if (next && !brokenAssets[key]) {
      setBrokenLoading((p) => ({ ...p, [key]: true }));
      getBrokenAssets(key === "(no workspace)" ? null : key).then((r) => {
        setBrokenAssets((p) => ({ ...p, [key]: r.success ? (r.data ?? []) : [] }));
        setBrokenLoading((p) => ({ ...p, [key]: false }));
      });
    }
  };

  const handleDeleteAsset = (key: string, id: string) => {
    if (!confirm("Permanently delete this asset (and its stored file)? This cannot be undone.")) return;
    startTransition(async () => {
      const r = await deleteAsset(id);
      setFeedback(r.success
        ? { type: "success", message: "Asset deleted." }
        : { type: "error", message: r.error ?? "Failed to delete asset." });
      if (r.success) {
        loadAssetHealth();
        setBrokenAssets((p) => { const n = { ...p }; delete n[key]; return n; });
        setExpandedHealth(null);
      }
    });
  };

  const handleRegenerateAsset = (key: string, id: string) => {
    startTransition(async () => {
      const r = await regenerateAsset(id);
      setFeedback(r.success
        ? { type: "success", message: "Asset regenerated." }
        : { type: "error", message: r.error ?? "Failed to regenerate asset." });
      if (r.success) {
        loadAssetHealth();
        setBrokenAssets((p) => { const n = { ...p }; delete n[key]; return n; });
      }
    });
  };
  const [selTenant, setSelTenant] = useState("");
  const [selPlan, setSelPlan] = useState("starter");
  const [seats, setSeats] = useState(5);
  const [expiry, setExpiry] = useState("");
  // Per-row tenant choice for users who currently have no tenant ("unassigned")
  const [tenantForUser, setTenantForUser] = useState<Record<string, string>>({});

  const loadData = useCallback(() => {
    startLoading(async () => {
      const [s, t, l, u, a] = await Promise.all([getDashboardStats(), getAllTenants(), getLicenses(), getAllUsers(), getAdminAudit(100)]);
      if (s.success) setStats(s.data);
      if (t.success) setTenants(t.data ?? []);
      if (l.success) setLicenses(l.data ?? []);
      if (u.success) setUsers(u.data ?? []);
      if (a.success) setAudit(a.data ?? []);
    });
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const handleIssue = () => {
    if (!selTenant) return;
    startTransition(async () => {
      const r = await issueLicense(selTenant, selPlan, seats, expiry || undefined);
      if (r.success) { setFeedback({ type: "success", message: "License issued." }); setShowForm(false); loadData(); }
      else setFeedback({ type: "error", message: r.error ?? "Failed." });
    });
  };

  const handleDeleteUser = (userId: string, email: string) => {
    if (!confirm(`Permanently delete user ${email}?\n\nThis removes their auth account, all role assignments, and detaches their posts (content stays with the tenant). This cannot be undone.`)) return;
    if (!confirm("Are you absolutely sure? There is no recovery.")) return;
    startTransition(async () => {
      const r = await deleteUser(userId);
      setFeedback(r.success
        ? { type: "success", message: "User permanently deleted." }
        : { type: "error", message: r.error ?? "Failed to delete user." });
      loadData();
    });
  };

  const handleShowAudit = (licenseId: string) => {
    const next = expandedAudit === licenseId ? null : licenseId;
    setExpandedAudit(next);
    if (next && !auditFor[licenseId]) {
      startTransition(async () => {
        const r = await getLicenseAudit(licenseId);
        if (r.success) setAuditFor((prev) => ({ ...prev, [licenseId]: r.data ?? [] }));
      });
    }
  };

  const auditLabel = (a: LicenseAuditEntry) => {
    const details = a.details ?? {};
    switch (a.action) {
      case "renewed": return `Renewed +${details.days ?? "?"} days → expires ${details.expires_at ? new Date(String(details.expires_at)).toLocaleDateString() : "?"}`;
      case "plan_changed": return `Plan changed → ${details.planId ?? "?"}`;
      case "revoked": return "License revoked";
      case "issued": return `Issued (${details.planId ?? "?"}, ${details.seats ?? "?"} seats)`;
      case "deleted": return "License permanently deleted";
      case "trial_started": return "Converted to trial (14 days)";
      case "trial_ended": return "Converted to full license";
      default: return a.action.replace(/_/g, " ");
    }
  };

  const handleDeleteLicense = (licenseId: string, key: string) => {
    if (!confirm(`Permanently delete license ${key}?\n\nThis removes the row entirely (not just revoke). Cannot be undone.`)) return;
    startTransition(async () => {
      const r = await deleteLicense(licenseId);
      setFeedback(r.success
        ? { type: "success", message: "License permanently deleted." }
        : { type: "error", message: r.error ?? "Failed to delete license." });
      loadData();
    });
  };

  const supabaseBrowser = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
  const [loginAsTenant, setLoginAsTenant] = useState<string | null>(null);

  /**
   * "Login as..." — one-way support access. The tenant must have opted in
   * (Settings → Admin Assistance); the route hard-fails otherwise. The API
   * mints a one-time magic link for the tenant's owner and we complete it
   * here, so the browser now holds the TENANT's session — never the reverse.
   */
  const handleLoginAs = async (tenant: TenantSummary) => {
    if (!confirm(`Sign in as the owner of "${tenant.name}"?\n\nThe tenant must have enabled admin assistance. This switches your session to their panel (one-way).`)) return;
    setLoginAsTenant(tenant.id);
    setFeedback(null);
    try {
      const res = await fetch("/api/admin/login-as", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenantId: tenant.id }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.token) {
        setFeedback({ type: "error", message: data.error ?? "Login-as failed." });
        setLoginAsTenant(null);
        return;
      }
      const { error } = await supabaseBrowser.auth.verifyOtp({
        type: "magiclink",
        token_hash: data.token,
      });
      if (error) {
        setFeedback({ type: "error", message: error.message });
        setLoginAsTenant(null);
        return;
      }
      // Wait for the session cookie to be visible server-side, then go.
      let attempts = 0;
      const check = async () => {
        attempts += 1;
        const sres = await fetch("/api/auth/session", { credentials: "include" });
        if (sres.ok) {
          window.location.href = "/dashboard";
          return;
        }
        if (attempts < 8) setTimeout(check, 350);
        else {
          setFeedback({ type: "error", message: "Session established — refresh and try again." });
          setLoginAsTenant(null);
        }
      };
      void check();
    } catch (err: any) {
      setFeedback({ type: "error", message: err?.message ?? "Login-as failed." });
      setLoginAsTenant(null);
    }
  };

  const handleDeleteTenant = (tenant: TenantSummary) => {
    const typed = prompt(`Permanently delete tenant "${tenant.name}"?\n\nThis deletes ALL of its clients, posts, media, chats, campaigns, licenses, and the auth accounts of its users. Type the tenant name to confirm:`);
    if (typed === null || typed.trim() !== tenant.name) return;
    if (!confirm(`Final warning: deleting "${tenant.name}" cannot be undone. Continue?`)) return;
    startTransition(async () => {
      const r = await deleteTenant(tenant.id);
      setFeedback(r.success
        ? { type: "success", message: `Tenant permanently deleted${r.data?.deletedAccounts ? ` (${r.data.deletedAccounts} user accounts removed)` : ""}.` }
        : { type: "error", message: r.error ?? "Failed to delete tenant." });
      loadData();
    });
  };

  const handleAssignLevel = (userId: string, role: string, tenantId?: string) => {
    startTransition(async () => {
      const r = await assignLevel(userId, role, tenantId);
      if (r.success) {
        setFeedback({ type: "success", message: "Level updated." });
        // Clear the per-row tenant choice now that the user has one
        setTenantForUser((prev) => {
          const next = { ...prev };
          delete next[userId];
          return next;
        });
        loadData();
      } else {
        setFeedback({ type: "error", message: r.error ?? "Failed to update level." });
      }
    });
  };

  if (!stats && isLoading) return <div className="flex justify-center py-20"><Loader2 className="size-8 animate-spin text-muted-foreground" /></div>;

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div><h1 className="text-3xl font-bold tracking-tight">Super Admin</h1><p className="text-muted-foreground mt-1">Platform management.</p></div>
        <div className="flex items-center gap-2">
          <a href="/dashboard/admin/page-builder">
            <Button variant="outline"><LayoutTemplate className="size-4 mr-2" /> Page Builder</Button>
          </a>
          <a href="/dashboard/admin/nav-builder">
            <Button variant="outline"><Menu className="size-4 mr-2" /> Menu Builder</Button>
          </a>
          <a href="/dashboard/admin/subscriptions">
            <Button variant="outline"><Wallet className="size-4 mr-2" /> Subscriptions</Button>
          </a>
          <Button onClick={() => setShowForm(!showForm)} disabled={isPending}>{showForm ? <><X className="size-4 mr-2" /> Cancel</> : <><Key className="size-4 mr-2" /> Issue License</>}</Button>
        </div>
      </div>

      {feedback && (
        <div className={`p-3 rounded-md text-sm ${feedback.type === "success" ? "bg-green-50 text-green-700 border-green-200" : "bg-red-50 text-red-700 border-red-200"} border`} role="alert">
          {feedback.message}<button className="ml-3 underline text-xs" onClick={() => setFeedback(null)}>Dismiss</button>
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Tenants</CardTitle></CardHeader><CardContent><div className="flex items-center gap-2"><Building2 className="size-5 text-primary" /><span className="text-2xl font-bold">{stats?.totalTenants ?? 0}</span></div></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Clients</CardTitle></CardHeader><CardContent><div className="flex items-center gap-2"><Users className="size-5 text-primary" /><span className="text-2xl font-bold">{stats?.totalClients ?? 0}</span></div></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Posts</CardTitle></CardHeader><CardContent><div className="flex items-center gap-2"><FileText className="size-5 text-primary" /><span className="text-2xl font-bold">{stats?.totalPosts ?? 0}</span></div></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Licenses</CardTitle></CardHeader><CardContent><div className="flex items-center gap-2"><Key className="size-5 text-primary" /><span className="text-2xl font-bold">{licenses.filter(l => l.status === "active").length}</span></div></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Revenue</CardTitle></CardHeader><CardContent><div className="flex items-center gap-2"><TrendingUp className="size-5 text-primary" /><span className="text-2xl font-bold">$0</span></div></CardContent></Card>
      </div>

      <Card><CardHeader><CardTitle className="flex items-center gap-2"><UserCog className="size-5 text-primary" /> All Users</CardTitle></CardHeader><CardContent>
        <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b text-left"><th className="py-2 px-3 text-muted-foreground">Email</th><th className="py-2 px-3 text-muted-foreground">Level</th><th className="py-2 px-3 text-muted-foreground">Tenant</th><th className="py-2 px-3 text-muted-foreground">Plan</th><th className="py-2 px-3 text-muted-foreground">Status</th><th className="py-2 px-3 text-muted-foreground">Assign Level</th><th className="py-2 px-3 text-muted-foreground">Delete</th></tr></thead><tbody>
        {users.map(u => (
          <tr key={u.user_id} className="border-b last:border-0">
            <td className="py-3 px-3 font-medium">{u.email}</td>
            <td className="py-3 px-3">
              <Badge className={u.role === "super_admin" ? "bg-purple-100 text-purple-700" : u.role === "agency_admin" ? "bg-blue-100 text-blue-700" : u.role === "agency_editor" ? "bg-cyan-100 text-cyan-700" : "bg-gray-100 text-gray-700"}>
                {levelLabel(u.role)}
              </Badge>
            </td>
            <td className="py-3 px-3">{u.tenant_name}</td>
            <td className="py-3 px-3"><Badge variant="outline">{u.plan_id ?? "-"}</Badge></td>
            <td className="py-3 px-3">
              {u.is_trial && <Badge className="bg-blue-100 text-blue-700">Trial</Badge>}
              {!u.is_trial && <Badge className={statusColor(u.license_status)}>{u.license_status ?? "none"}</Badge>}
            </td>
            <td className="py-3 px-3">
              {u.role === "super_admin" ? (
                <span className="text-xs text-muted-foreground" title="Super admin accounts can never be deleted">Protected</span>
              ) : (
                <Button variant="ghost" size="sm" className="text-destructive" onClick={() => handleDeleteUser(u.user_id, u.email)}>Delete</Button>
              )}
            </td>
            <td className="py-3 px-3">
              {!u.tenant_id ? (
                <div className="flex items-center gap-2">
                  <Select
                    value={tenantForUser[u.user_id] ?? ""}
                    onValueChange={(v) => setTenantForUser(prev => ({ ...prev, [u.user_id]: v }))}
                  >
                    <SelectTrigger className="w-44">
                      <SelectValue placeholder={tenants.length === 0 ? "No tenants yet" : "Tenant..."} />
                    </SelectTrigger>
                    <SelectContent>
                      {tenants.map(t => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <Select value={u.role} onValueChange={(v) => handleAssignLevel(u.user_id, v, tenantForUser[u.user_id])}>
                    <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {LEVELS.map(lvl => <SelectItem key={lvl.id} value={lvl.id}>{lvl.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              ) : (
                <Select value={u.role} onValueChange={(v) => handleAssignLevel(u.user_id, v)}>
                  <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {LEVELS.map(lvl => <SelectItem key={lvl.id} value={lvl.id}>{lvl.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              )}
            </td>
          </tr>
        ))}
        {users.length === 0 && (
          <tr><td colSpan={7} className="py-3 px-3 text-muted-foreground text-center">No users found.</td></tr>
        )}
        </tbody></table></div>
      </CardContent></Card>

      {showForm && (
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><Shield className="size-5 text-primary" /> Issue New License</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2"><Label>Tenant (Agency Customer)</Label><Select onValueChange={setSelTenant}><SelectTrigger><SelectValue placeholder={tenants.length === 0 ? "No agencies yet — sign up at /register" : "Select tenant..."} /></SelectTrigger><SelectContent>{tenants.map(t => <SelectItem key={t.id} value={t.id}>{t.name} ({t.slug})</SelectItem>)}</SelectContent></Select></div>
              <div className="space-y-2"><Label>Plan</Label><Select onValueChange={setSelPlan} defaultValue="starter"><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{PLANS.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent></Select></div>
              <div className="space-y-2"><Label>Seats</Label><Input type="number" min={1} value={seats} onChange={e => setSeats(Number(e.target.value))} /></div>
              <div className="space-y-2"><Label>Expires (optional)</Label><Input type="date" value={expiry} onChange={e => setExpiry(e.target.value)} /></div>
            </div>
            <Button onClick={handleIssue} disabled={isPending}>{isPending ? <><Loader2 className="size-4 animate-spin mr-2" /> Issuing...</> : "Issue License"}</Button>
          </CardContent>
        </Card>
      )}

      <Card><CardHeader><CardTitle className="flex items-center gap-2"><Key className="size-5 text-primary" /> Licenses</CardTitle></CardHeader><CardContent>
        <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b text-left"><th className="py-2 px-3 text-muted-foreground">Key</th><th className="py-2 px-3 text-muted-foreground">Tenant</th><th className="py-2 px-3 text-muted-foreground">Plan</th><th className="py-2 px-3 text-muted-foreground">Expires</th><th className="py-2 px-3 text-muted-foreground">Seats</th><th className="py-2 px-3 text-muted-foreground">Status</th><th className="py-2 px-3 text-muted-foreground">Hubs</th><th className="py-2 px-3 text-muted-foreground">Actions</th></tr></thead><tbody>
        {licenses.map(l => (
          <tr key={l.id} className="border-b last:border-0">
            <td className="py-3 px-3 font-mono text-xs">{l.license_key}</td>
            <td className="py-3 px-3">{l.tenant_name ?? l.tenant_id}</td>
            <td className="py-3 px-3">
              <Select
                value={l.plan_id}
                onValueChange={(v) => startTransition(async () => {
                  const r = await updateLicensePlan(l.id, v);
                  setFeedback(r.success
                    ? { type: "success", message: `Plan changed to ${v} — trial flag cleared.` }
                    : { type: "error", message: r.error ?? "Failed to change plan." });
                  loadData();
                })}
              >
                <SelectTrigger className="w-32 h-7 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PLANS.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </td>
            <td className="py-3 px-3 text-xs">{l.expires_at ? new Date(l.expires_at).toLocaleDateString() : "—"}</td>
            <td className="py-3 px-3">{l.seats_used}/{l.seats_total}</td>
            <td className="py-3 px-3"><Badge className={statusColor(l.status)}>{l.status}</Badge></td>
            <td className="py-3 px-3">
              <div className="flex flex-wrap gap-1 items-center max-w-[180px]">
                {(l.hubs ?? []).map(h => {
                  const name = HUBS.find(x => x.id === h)?.name ?? h;
                  return (
                    <span key={h} className="inline-flex items-center gap-1 rounded-full bg-primary/10 border border-primary/20 px-2 py-0.5 text-[10px] font-medium text-primary">
                      {name}
                      <button
                        onClick={() => startTransition(async () => {
                          const r = await revokeHub(l.tenant_id, h);
                          setFeedback(r.success
                            ? { type: "success", message: `Removed ${name} hub.` }
                            : { type: "error", message: r.error ?? "Failed to remove hub." });
                          loadData();
                        })}
                        title={`Remove ${name} hub`}
                        className="hover:text-destructive"
                      >
                        ×
                      </button>
                    </span>
                  );
                })}
                {HUBS.filter(h => !(l.hubs ?? []).includes(h.id)).map(h => (
                  <button
                    key={h.id}
                    onClick={() => startTransition(async () => {
                      const r = await grantHub(l.tenant_id, h.id);
                      setFeedback(r.success
                        ? { type: "success", message: `Granted ${h.name} hub (no payment).` }
                        : { type: "error", message: r.error ?? "Failed to grant hub." });
                      loadData();
                    })}
                    title={`Grant ${h.name} hub without payment`}
                    className="inline-flex items-center rounded-full border border-dashed px-2 py-0.5 text-[10px] text-muted-foreground hover:border-primary hover:text-primary transition-colors"
                  >
                    + {h.name}
                  </button>
                ))}
              </div>
            </td>
            <td className="py-3 px-3 flex gap-1 flex-wrap">
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleShowAudit(l.id)}
                title="View this license's change history"
              >
                History
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => startTransition(async () => {
                  const r = await renewLicense(l.id, 30);
                  setFeedback(r.success
                    ? { type: "success", message: "License renewed +30 days (free, no payment)." }
                    : { type: "error", message: r.error ?? "Failed to renew." });
                  loadData();
                })}
                title="Renew this license +30 days without payment"
              >
                Renew
              </Button>
              {l.status === "active" && <Button variant="ghost" size="sm" onClick={() => startTransition(async () => { await revokeLicense(l.id); loadData(); })}>Revoke</Button>}
              {l.is_trial
                ? <Button variant="outline" size="sm" className="text-green-600" onClick={() => startTransition(async () => {
                    const r = await setLicenseTrial(l.id, false);
                    setFeedback(r.success
                      ? { type: "success", message: "Converted to full license — trial flag cleared." }
                      : { type: "error", message: r.error ?? "Failed to convert." });
                    loadData();
                  })} title="Convert this trial to a full license">Make full</Button>
                : <Button variant="outline" size="sm" onClick={() => startTransition(async () => {
                    const r = await setLicenseTrial(l.id, true);
                    setFeedback(r.success
                      ? { type: "success", message: "Converted back to trial — 14 days from today." }
                      : { type: "error", message: r.error ?? "Failed to convert." });
                    loadData();
                  })} title="Convert this full license back to a trial">Make trial</Button>}
              <Button variant="ghost" size="sm" className="text-destructive" onClick={() => handleDeleteLicense(l.id, l.license_key)}>Delete</Button>
            </td>
          </tr>
        ))}
        {licenses.map(l => expandedAudit === l.id && (
          <tr key={l.id + "-audit"}>
            <td colSpan={7} className="py-2 px-3 bg-muted/30">
              <div className="text-xs">
                <p className="font-semibold mb-2">Change History</p>
                {auditFor[l.id]?.length ? (
                  <ul className="space-y-1.5">
                    {auditFor[l.id].map((a) => (
                      <li key={a.id} className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium">{auditLabel(a)}</span>
                        <span className="text-muted-foreground">by {a.actor_email ?? "unknown"}</span>
                        <span className="text-muted-foreground">· {new Date(a.created_at).toLocaleString()}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-muted-foreground">No changes logged yet.</p>
                )}
              </div>
            </td>
          </tr>
        ))}
        </tbody></table></div>
      </CardContent></Card>

      <Card><CardHeader><CardTitle className="flex items-center gap-2"><Building2 className="size-5 text-primary" /> All Tenants</CardTitle></CardHeader><CardContent>
        <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b text-left"><th className="py-2 px-3 text-muted-foreground">Name</th><th className="py-2 px-3 text-muted-foreground">Slug</th><th className="py-2 px-3 text-muted-foreground">Clients</th><th className="py-2 px-3 text-muted-foreground">Plan</th><th className="py-2 px-3 text-muted-foreground">Status</th><th className="py-2 px-3 text-muted-foreground">Joined</th><th className="py-2 px-3 text-muted-foreground">Actions</th></tr></thead><tbody>
        {tenants.map(t => (
          <tr key={t.id} className="border-b last:border-0">
            <td className="py-3 px-3 font-medium">{t.name}</td><td className="py-3 px-3 text-muted-foreground">{t.slug}</td><td className="py-3 px-3">{t.client_count}</td>
            <td className="py-3 px-3"><Badge variant="outline">{t.plan_id ?? "-"}</Badge></td>
            <td className="py-3 px-3"><Badge className={statusColor(t.subscription_status)}>{t.subscription_status ?? "none"}</Badge></td>
            <td className="py-3 px-3 text-muted-foreground">{new Date(t.created_at).toLocaleDateString()}</td>
            <td className="py-3 px-3">
              <div className="flex gap-1">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void handleLoginAs(t)}
                  disabled={loginAsTenant === t.id}
                  title="Enter this tenant's panel (requires their opt-in — one-way)"
                >
                  {loginAsTenant === t.id ? (
                    <><Loader2 className="size-3 animate-spin mr-1" /> Signing in…</>
                  ) : (
                    <><LogIn className="size-3 mr-1" /> Login as</>
                  )}
                </Button>
                {t.protected ? (
                  <span className="text-xs text-muted-foreground" title="Holds the super admin — can never be deleted">Protected</span>
                ) : (
                  <Button variant="ghost" size="sm" className="text-destructive" onClick={() => handleDeleteTenant(t)}>Delete</Button>
                )}
              </div>
            </td>
          </tr>
        ))}
        </tbody></table></div>
      </CardContent></Card>

      <Card><CardHeader><CardTitle className="flex items-center gap-2"><Shield className="size-5 text-primary" /> Audit Log</CardTitle></CardHeader><CardContent>
        {audit.length === 0 ? (
          <p className="text-muted-foreground text-sm">No admin actions logged yet.</p>
        ) : (
          <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b text-left"><th className="py-2 px-3 text-muted-foreground">When</th><th className="py-2 px-3 text-muted-foreground">Actor</th><th className="py-2 px-3 text-muted-foreground">Action</th><th className="py-2 px-3 text-muted-foreground">Target</th><th className="py-2 px-3 text-muted-foreground">Details</th></tr></thead><tbody>
          {audit.map(a => (
            <tr key={a.id} className="border-b last:border-0">
              <td className="py-2 px-3 text-muted-foreground whitespace-nowrap">{new Date(a.created_at).toLocaleString()}</td>
              <td className="py-2 px-3">{a.actor_email ?? "—"}</td>
              <td className="py-2 px-3"><Badge className={auditBadgeClass(a.action)}>{actionLabel(a.action)}</Badge></td>
              <td className="py-2 px-3">{a.target_label ?? a.target_id ?? "—"}</td>
              <td className="py-2 px-3 text-muted-foreground">{
                a.details && Object.keys(a.details).length > 0
                  ? JSON.stringify(a.details)
                  : ""
              }</td>
            </tr>
          ))}
          </tbody></table></div>
        )}
      </CardContent></Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ImageIcon className="size-5 text-primary" /> Asset Health
            <Button variant="ghost" size="sm" onClick={() => void loadAssetHealth()} disabled={healthLoading} className="ml-2">
              {healthLoading ? <><Loader2 className="size-3 animate-spin mr-1" /> Checking…</> : "Re-check"}
            </Button>
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Per-workspace smoke test of stored asset bytes (same magic-byte check the CI asset-integrity job runs).
          </p>
        </CardHeader>
        <CardContent>
          {healthLoading && assetHealth === null ? (
            <div className="flex justify-center py-6"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>
          ) : assetHealth && assetHealth.length === 0 ? (
            <p className="text-sm text-muted-foreground">No media assets in any workspace yet.</p>
          ) : assetHealth ? (
            <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b text-left"><th className="py-2 px-3 text-muted-foreground">Tenant</th><th className="py-2 px-3 text-muted-foreground">Workspace</th><th className="py-2 px-3 text-muted-foreground">Total</th><th className="py-2 px-3 text-muted-foreground">Healthy</th><th className="py-2 px-3 text-muted-foreground">Broken</th><th className="py-2 px-3 text-muted-foreground">Empty URL</th><th className="py-2 px-3 text-muted-foreground">Non-CDN</th><th className="py-2 px-3 text-muted-foreground">Storage</th><th className="py-2 px-3 text-muted-foreground">Checked</th></tr></thead><tbody>
              {assetHealth.map((h) => {
                const key = h.workspaceId ?? "(no workspace)";
                const issueCount = h.broken + h.emptyUrl + h.nonCdn;
                const hasIssues = issueCount > 0;
                const expanded = expandedHealth === key;
                return (
                  <Fragment key={key}>
                    <tr
                      className={`border-b last:border-0 ${hasIssues ? "cursor-pointer hover:bg-muted/40" : ""}`}
                      onClick={hasIssues ? () => toggleHealthRow(key) : undefined}
                      title={hasIssues ? "Click to list broken assets" : undefined}
                    >
                      <td className="py-2 px-3">{h.tenantName}</td>
                      <td className="py-2 px-3 font-medium">{h.workspaceName}</td>
                      <td className="py-2 px-3">{h.total}</td>
                      <td className="py-2 px-3">{!hasIssues ? <Badge className="bg-green-100 text-green-700">{h.ok} OK</Badge> : <span>{h.ok}</span>}</td>
                      <td className="py-2 px-3">{h.broken > 0 ? <Badge className="bg-red-100 text-red-700">{h.broken}</Badge> : <span>0</span>}</td>
                      <td className="py-2 px-3">{h.emptyUrl > 0 ? <Badge className="bg-orange-100 text-orange-700">{h.emptyUrl}</Badge> : <span>0</span>}</td>
                      <td className="py-2 px-3">{h.nonCdn > 0 ? <Badge className="bg-yellow-100 text-yellow-700">{h.nonCdn}</Badge> : <span>0</span>}</td>
                      <td className="py-2 px-3 whitespace-nowrap" title={`${(h.storageBytes ?? 0).toLocaleString()} bytes`}>{formatBytes(h.storageBytes ?? 0)}</td>
                      <td className="py-2 px-3 text-muted-foreground text-xs">
                        {new Date(h.checkedAt).toLocaleTimeString()}
                        {hasIssues && <span className="ml-1 text-primary">{expanded ? "▲" : "▼"}</span>}
                      </td>
                    </tr>
                    {expanded && (
                      <tr className="border-b last:border-0 bg-muted/20">
                        <td colSpan={9} className="py-3 px-4">
                          <div className="text-sm">
                            <p className="font-medium mb-2">Broken assets in “{h.workspaceName}”</p>
                            {brokenLoading[key] ? (
                              <div className="flex items-center gap-2 py-2 text-muted-foreground"><Loader2 className="size-4 animate-spin" /> Checking…</div>
                            ) : !brokenAssets[key] || brokenAssets[key].length === 0 ? (
                              <p className="text-muted-foreground">No broken assets found in this workspace (the counts above may reflect a previous check).</p>
                            ) : (
                              <table className="w-full text-xs">
                                <thead><tr className="border-b text-left text-muted-foreground"><th className="py-1 pr-2">Type</th><th className="py-1 pr-2">Reason</th><th className="py-1 pr-2">Prompt / URL</th><th className="py-1">Actions</th></tr></thead>
                                <tbody>
                                  {brokenAssets[key].map((b) => (
                                    <tr key={b.id} className="border-b last:border-0">
                                      <td className="py-1 pr-2">{b.type ?? "—"}</td>
                                      <td className="py-1 pr-2">
                                        <Badge className={
                                          b.reason === "empty-url" ? "bg-orange-100 text-orange-700" :
                                          b.reason === "non-cdn" ? "bg-yellow-100 text-yellow-700" :
                                          "bg-red-100 text-red-700"
                                        }>{b.reason}</Badge>
                                        <span className="text-muted-foreground ml-1">{b.detail}</span>
                                      </td>
                                      <td className="py-1 pr-2 max-w-[320px] truncate">{b.prompt ? b.prompt.slice(0, 60) : (b.url ?? "")}</td>
                                      <td className="py-1 whitespace-nowrap">
                                        {b.prompt && (
                                          <Button variant="outline" size="sm" disabled={isPending} onClick={() => handleRegenerateAsset(key, b.id)} className="mr-1">
                                            Regenerate
                                          </Button>
                                        )}
                                        <Button variant="destructive" size="sm" disabled={isPending} onClick={() => handleDeleteAsset(key, b.id)}>
                                          Delete
                                        </Button>
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
              </tbody></table></div>
          ) : null}
        </CardContent>
      </Card>

      <TokenBilling />
    </div>
  );
}