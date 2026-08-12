"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Loader2, Building2, Users, FileText, Key, TrendingUp, Shield, X, UserCog } from "lucide-react";
import { getDashboardStats, getAllTenants, getLicenses, issueLicense, updateLicensePlan, renewLicense, revokeLicense, deleteLicense, deleteUser, deleteTenant, getAllUsers, assignLevel, type TenantSummary, type LicenseRecord, type UserRecord } from "./actions";

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
  const [feedback, setFeedback] = useState<{ type: string; message: string } | null>(null);
  const [isLoading, startLoading] = useTransition();
  const [isPending, startTransition] = useTransition();
  const [showForm, setShowForm] = useState(false);
  const [selTenant, setSelTenant] = useState("");
  const [selPlan, setSelPlan] = useState("starter");
  const [seats, setSeats] = useState(5);
  const [expiry, setExpiry] = useState("");
  // Per-row tenant choice for users who currently have no tenant ("unassigned")
  const [tenantForUser, setTenantForUser] = useState<Record<string, string>>({});

  const loadData = useCallback(() => {
    startLoading(async () => {
      const [s, t, l, u] = await Promise.all([getDashboardStats(), getAllTenants(), getLicenses(), getAllUsers()]);
      if (s.success) setStats(s.data);
      if (t.success) setTenants(t.data ?? []);
      if (l.success) setLicenses(l.data ?? []);
      if (u.success) setUsers(u.data ?? []);
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
    if (!confirm(`Permanently delete user ${email}?\n\nThis removes their auth account and all role assignments. Their posts remain with the tenant. This cannot be undone.`)) return;
    if (!confirm("Are you absolutely sure? There is no recovery.")) return;
    startTransition(async () => {
      const r = await deleteUser(userId);
      setFeedback(r.success
        ? { type: "success", message: "User permanently deleted." }
        : { type: "error", message: r.error ?? "Failed to delete user." });
      loadData();
    });
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
        <Button onClick={() => setShowForm(!showForm)} disabled={isPending}>{showForm ? <><X className="size-4 mr-2" /> Cancel</> : <><Key className="size-4 mr-2" /> Issue License</>}</Button>
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
              <Button variant="ghost" size="sm" className="text-destructive" onClick={() => handleDeleteUser(u.user_id, u.email)}>Delete</Button>
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
        <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b text-left"><th className="py-2 px-3 text-muted-foreground">Key</th><th className="py-2 px-3 text-muted-foreground">Tenant</th><th className="py-2 px-3 text-muted-foreground">Plan</th><th className="py-2 px-3 text-muted-foreground">Expires</th><th className="py-2 px-3 text-muted-foreground">Seats</th><th className="py-2 px-3 text-muted-foreground">Status</th><th className="py-2 px-3 text-muted-foreground">Actions</th></tr></thead><tbody>
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
            <td className="py-3 px-3 flex gap-1 flex-wrap">
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
              <Button variant="ghost" size="sm" className="text-destructive" onClick={() => handleDeleteLicense(l.id, l.license_key)}>Delete</Button>
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
            <td className="py-3 px-3"><Button variant="ghost" size="sm" className="text-destructive" onClick={() => handleDeleteTenant(t)}>Delete</Button></td>
          </tr>
        ))}
        </tbody></table></div>
      </CardContent></Card>
    </div>
  );
}