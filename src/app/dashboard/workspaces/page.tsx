"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Loader2, Plus, Trash2, Building2, ArrowRight, Users, UserPlus } from "lucide-react";
import Link from "next/link";
import { getWorkspaces, createWorkspace, deleteWorkspace, getWorkspaceTeamAccess, setWorkspaceMemberAccess, type Workspace, type TeamMemberAccess } from "@/lib/workspace";
import { inviteTeamMember } from "@/lib/workspace-team";

function roleLabel(role: string) {
  if (role === "super_admin") return "Super Admin";
  if (role === "agency_admin") return "Admin";
  if (role === "agency_editor") return "Editor";
  if (role === "client") return "User / Client";
  return role;
}

function lastSeen(lastSignInAt: string | null) {
  if (!lastSignInAt) return "never signed in";
  const d = new Date(lastSignInAt);
  const mins = Math.round((Date.now() - d.getTime()) / 60000);
  if (mins < 1) return "online now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return d.toLocaleDateString();
}

export default function WorkspacesPage() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [feedback, setFeedback] = useState<{ type: string; message: string } | null>(null);
  const [isLoading, startLoading] = useTransition();
  const [isPending, startTransition] = useTransition();
  const [showForm, setShowForm] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [teamPanel, setTeamPanel] = useState<string | null>(null);
  const [teamCanManage, setTeamCanManage] = useState(false);
  const [teamMembers, setTeamMembers] = useState<Record<string, TeamMemberAccess[]>>({});
  const [teamLoading, setTeamLoading] = useState<string | null>(null);

  // Add-team-member form
  const [showInvite, setShowInvite] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("agency_editor");
  const [inviteWorkspaceIds, setInviteWorkspaceIds] = useState<string[]>([]);

  const load = useCallback(() => {
    startLoading(async () => {
      const res = await getWorkspaces();
      if (res.success && res.data) setWorkspaces(res.data);
    });
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleCreate = () => {
    if (!newName.trim()) return;
    startTransition(async () => {
      const res = await createWorkspace(newName, newDesc || undefined);
      if (res.success) {
        setNewName("");
        setNewDesc("");
        setShowForm(false);
        setFeedback({ type: "success", message: `Workspace "${newName}" created.` });
        load();
      } else {
        setFeedback({ type: "error", message: res.error ?? "Failed to create." });
      }
    });
  };

  const handleDelete = (id: string, name: string) => {
    if (!confirm(`Delete "${name}"? All data in this workspace will be permanently removed.`)) return;
    startTransition(async () => {
      const res = await deleteWorkspace(id);
      if (res.success) { setFeedback({ type: "success", message: `${name} deleted.` }); load(); }
      else setFeedback({ type: "error", message: res.error ?? "Failed." });
    });
  };

  const toggleTeamPanel = async (workspaceId: string) => {
    if (teamPanel === workspaceId) { setTeamPanel(null); return; }
    setTeamPanel(workspaceId);
    setTeamLoading(workspaceId);
    const res = await getWorkspaceTeamAccess(workspaceId);
    setTeamLoading(null);
    if (res.success && res.data) {
      setTeamCanManage(res.data.canManage);
      setTeamMembers((prev) => ({ ...prev, [workspaceId]: res.data!.members }));
    }
  };

  const handleToggleMember = async (workspaceId: string, userId: string, granted: boolean) => {
    setTeamLoading(workspaceId);
    const res = await setWorkspaceMemberAccess(workspaceId, userId, granted);
    if (res.success) {
      setTeamMembers((prev) => ({
        ...prev,
        [workspaceId]: (prev[workspaceId] ?? []).map((m) => m.userId === userId ? { ...m, granted } : m),
      }));
      setFeedback({ type: "success", message: granted ? "Member granted access." : "Member access removed." });
    } else {
      setFeedback({ type: "error", message: res.error ?? "Failed to update access." });
    }
    setTeamLoading(null);
  };

  const toggleInviteWorkspace = (id: string) => {
    setInviteWorkspaceIds((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);
  };

  const handleInvite = () => {
    if (!inviteEmail.trim()) return;
    startTransition(async () => {
      const res = await inviteTeamMember(inviteEmail, inviteRole, inviteWorkspaceIds);
      if (res.success && res.data) {
        const msg = res.data.existing
          ? `"${inviteEmail}" added to the team.`
          : `"${inviteEmail}" invited. Share this temporary password: ${res.data.tempPassword}`;
        setFeedback({ type: "success", message: msg });
        setInviteEmail("");
        setInviteRole("agency_editor");
        setInviteWorkspaceIds([]);
        setShowInvite(false);
        load();
      } else {
        setFeedback({ type: "error", message: res.error ?? "Failed to invite member." });
      }
    });
  };

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Workspaces</h1>
          <p className="text-muted-foreground mt-1">Manage your workspaces. Each workspace has its own knowledgebase, brand profiles, and client data.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setShowInvite(!showInvite)} disabled={isPending}>
            {showInvite ? "Cancel" : <><UserPlus className="size-4 mr-2" /> Add member</>}
          </Button>
          <Button onClick={() => setShowForm(!showForm)} disabled={isPending}>
            {showForm ? "Cancel" : <><Plus className="size-4 mr-2" /> New Workspace</>}
          </Button>
        </div>
      </div>

      {feedback && (
        <div className={`p-3 rounded-md text-sm ${feedback.type === "success" ? "bg-green-50 text-green-700 border-green-200" : "bg-red-50 text-red-700 border-red-200"} border`} role="alert">
          {feedback.message}<button className="ml-3 underline text-xs" onClick={() => setFeedback(null)}>Dismiss</button>
        </div>
      )}

      {showInvite && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><UserPlus className="size-5 text-primary" /> Add team member</CardTitle>
            <CardDescription>Creates the account if needed and adds them to this team with access to the selected workspaces.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Email</Label>
              <Input type="email" placeholder="teammate@example.com" value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} disabled={isPending} />
            </div>
            <div className="space-y-2">
              <Label>Role</Label>
              <select
                value={inviteRole}
                onChange={(e) => setInviteRole(e.target.value)}
                disabled={isPending}
                className="w-full h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm"
              >
                <option value="agency_admin">Admin</option>
                <option value="agency_editor">Editor</option>
                <option value="client">User / Client</option>
              </select>
            </div>
            <div className="space-y-2">
              <Label>Workspace access</Label>
              <div className="space-y-1">
                {workspaces.map((w) => (
                  <label key={w.id} className="flex items-center gap-2 text-sm cursor-pointer">
                    <input
                      type="checkbox"
                      checked={inviteWorkspaceIds.includes(w.id)}
                      onChange={() => toggleInviteWorkspace(w.id)}
                      disabled={isPending}
                    />
                    {w.name}
                  </label>
                ))}
                {workspaces.length === 0 && <p className="text-xs text-muted-foreground">No workspaces yet — create one first, or invite without access and grant it later.</p>}
              </div>
            </div>
          </CardContent>
          <CardFooter>
            <Button onClick={handleInvite} disabled={isPending || !inviteEmail.trim()}>
              {isPending ? <><Loader2 className="size-4 animate-spin mr-2" /> Adding...</> : "Add member"}
            </Button>
          </CardFooter>
        </Card>
      )}

      {showForm && (
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><Building2 className="size-5 text-primary" /> Create Workspace</CardTitle><CardDescription>Each workspace is an isolated environment with its own knowledgebase and settings.</CardDescription></CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2"><Label>Workspace Name</Label><Input placeholder="My Agency Workspace" value={newName} onChange={(e) => setNewName(e.target.value)} disabled={isPending} /></div>
            <div className="space-y-2"><Label>Description (optional)</Label><Input placeholder="A brief description..." value={newDesc} onChange={(e) => setNewDesc(e.target.value)} disabled={isPending} /></div>
          </CardContent>
          <CardFooter><Button onClick={handleCreate} disabled={isPending || !newName.trim()}>{isPending ? <><Loader2 className="size-4 animate-spin mr-2" /> Creating...</> : "Create Workspace"}</Button></CardFooter>
        </Card>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {workspaces.map((w) => (
          <Card key={w.id} className={w.is_default ? "border-primary" : ""}>
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <span className="flex items-center gap-2 truncate"><Building2 className="size-4 text-primary shrink-0" />{w.name}</span>
                {w.is_default && <Badge variant="default" className="text-xs">Default</Badge>}
              </CardTitle>
              <CardDescription className="line-clamp-2">{w.description || "No description"}</CardDescription>
            </CardHeader>
            <CardContent className="text-xs text-muted-foreground">
              Slug: {w.slug}<br />Created: {new Date(w.created_at).toLocaleDateString()}
            </CardContent>
            <CardFooter className="flex gap-2">
              <Link href={`/dashboard/workspaces/${w.id}/knowledgebase`}><Button variant="outline" size="sm">Knowledgebase <ArrowRight className="size-3 ml-1" /></Button></Link>
              <Link href={`/dashboard/workspaces/${w.id}/brand-profile`}><Button variant="outline" size="sm">Brand Profile <ArrowRight className="size-3 ml-1" /></Button></Link>
              <Button variant="ghost" size="icon" className="ml-auto text-muted-foreground hover:text-destructive" onClick={() => handleDelete(w.id, w.name)} disabled={isPending}><Trash2 className="size-4" /></Button>
            </CardFooter>
            <div className="px-4 pb-4 -mt-2">
              <Button variant="ghost" size="sm" className="text-xs" onClick={() => toggleTeamPanel(w.id)}>
                <Users className="size-3.5 mr-1.5" /> Team access
              </Button>
              {teamPanel === w.id && (
                <div className="mt-2 rounded-md border bg-muted/30 p-3 space-y-2">
                  {teamLoading === w.id ? (
                    <div className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="size-3 animate-spin" /> Loading team…</div>
                  ) : !teamCanManage ? (
                    <p className="text-xs text-muted-foreground">Only admins can manage team access.</p>
                  ) : (teamMembers[w.id] ?? []).length === 0 ? (
                    <p className="text-xs text-muted-foreground">No team members yet. Use “Add member” above.</p>
                  ) : (
                    <ul className="space-y-2">
                      {(teamMembers[w.id] ?? []).map((m) => (
                        <li key={m.userId} className="flex items-center justify-between gap-3 text-xs">
                          <div className="min-w-0">
                            <div className="truncate font-medium">{m.email}</div>
                            <div className="text-muted-foreground">
                              {roleLabel(m.role)} · {lastSeen(m.lastSignInAt)}
                            </div>
                          </div>
                          {m.isOwner ? (
                            <Badge variant="secondary" className="shrink-0">Owner</Badge>
                          ) : (
                            <Switch
                              checked={m.granted}
                              onCheckedChange={(v) => handleToggleMember(w.id, m.userId, v)}
                              disabled={teamLoading === w.id}
                            />
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>
          </Card>
        ))}
        {workspaces.length === 0 && !isLoading && (
          <div className="col-span-full text-center py-12 text-muted-foreground">
            <Building2 className="size-12 mx-auto mb-4 opacity-30" />
            <p>No workspaces yet. Create your first workspace to get started.</p>
          </div>
        )}
        {isLoading && <div className="col-span-full flex justify-center py-12"><Loader2 className="size-8 animate-spin text-muted-foreground" /></div>}
      </div>
    </div>
  );
}