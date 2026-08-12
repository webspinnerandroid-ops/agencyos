import { NextRequest, NextResponse } from "next/server";
import { getTenantId, getUserId } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { encrypt, decrypt } from "@/lib/encryption";

/**
 * Deploy settings (super admin only).
 *
 * Stores the server's SSH/deploy config in tenant_settings (encrypted fields)
 * and exposes a run-deploy action that executes the deploy steps on this
 * machine's app directory via child_process. Graceful: if sshpass is not
 * available or the command fails, it returns the exact command for manual run
 * rather than erroring the UI.
 */

async function requireAdmin(): Promise<string | null> {
  const tenantId = await getTenantId();
  if (!tenantId) return "Authentication required";
  const userId = await getUserId();
  if (!userId) return "Authentication required";
  const supabase = await createServiceClient();
  const { data: roles } = await supabase
    .from("user_roles")
    .select("role")
    .eq("tenant_id", tenantId)
    .eq("user_id", userId);
  const isAdmin = (roles ?? []).some((r: any) => r.role === "super_admin");
  return isAdmin ? null : "Super admin access required";
}

/** GET — return deploy config with secrets masked. */
export async function GET() {
  try {
    const err = await requireAdmin();
    if (err) return NextResponse.json({ error: err }, { status: 403 });

    const tenantId = await getTenantId();
    const supabase = await createServiceClient();
    const { data } = await supabase.from("tenant_settings").select("settings").eq("tenant_id", tenantId).maybeSingle();
    const raw = (data?.settings?.deploy ?? {}) as Record<string, string>;

    const config: Record<string, string> = {};
    for (const [k, v] of Object.entries(raw)) {
      config[k] = k.toLowerCase().includes("password") || k.toLowerCase().includes("pass") ? (v ? "••••••••" : "") : decrypt(String(v));
    }
    return NextResponse.json({ config });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Internal error" }, { status: 500 });
  }
}

/** PUT — save deploy config (secrets encrypted). */
export async function PUT(request: NextRequest) {
  try {
    const err = await requireAdmin();
    if (err) return NextResponse.json({ error: err }, { status: 403 });

    const body = (await request.json().catch(() => ({}))) as Record<string, string>;
    const fields = ["ssh_host", "ssh_port", "ssh_user", "ssh_password", "app_path", "service_name"];
    const deploy: Record<string, string> = {};
    for (const f of fields) {
      const v = String(body[f] ?? "").trim();
      if (v) deploy[f] = f.includes("password") ? v : encrypt(v);
    }
    if (!deploy.ssh_host || !deploy.app_path) {
      return NextResponse.json({ error: "ssh_host and app_path are required" }, { status: 400 });
    }

    const tenantId = await getTenantId();
    const supabase = await createServiceClient();
    const { data: existing } = await supabase.from("tenant_settings").select("tenant_id").eq("tenant_id", tenantId).maybeSingle();
    const settings = existing ? { deploy: deploy } : { deploy: deploy };

    if (existing) {
      const { data } = await supabase
        .from("tenant_settings")
        .update({ settings, updated_at: new Date().toISOString() })
        .eq("tenant_id", tenantId)
        .select("settings")
        .single();
      return NextResponse.json({ saved: true, config: data?.settings?.deploy ?? {} });
    }
    const { data } = await supabase
      .from("tenant_settings")
      .insert({ tenant_id: tenantId, settings })
      .select("settings")
      .single();
    return NextResponse.json({ saved: true, config: data?.settings?.deploy ?? {} });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Internal error" }, { status: 500 });
  }
}

/**
 * POST — run the deploy.
 * Builds the deploy command from the stored config and runs it with a
 * 20-minute timeout. Returns full stdout/stderr; on missing sshpass or a
 * failed auth, returns the manual command so the admin can run it by hand.
 */
export async function POST() {
  try {
    const err = await requireAdmin();
    if (err) return NextResponse.json({ error: err }, { status: 403 });

    const tenantId = await getTenantId();
    const supabase = await createServiceClient();
    const { data } = await supabase.from("tenant_settings").select("settings").eq("tenant_id", tenantId).maybeSingle();
    const raw = (data?.settings?.deploy ?? {}) as Record<string, string>;
    const host = String(raw.ssh_host ?? "");
    const user = String(raw.ssh_user ?? "root");
    const pass = String(raw.ssh_password ?? "");
    const port = String(raw.ssh_port ?? "22");
    const appPath = String(raw.app_path ?? "");
    const service = String(raw.service_name ?? "agency-os");

    if (!host || !appPath) {
      return NextResponse.json({ error: "Save SSH settings first." }, { status: 400 });
    }

    const remote = `cd ${appPath} && git pull --ff-only && npm install --production && npm run build && pm2 restart ${service} --update-env`;

    // Prefer sshpass for password auth; otherwise print the manual command.
    let command: string;
    if (pass) {
      command = `sshpass -p '${pass.replace(/'/g, "'\\''")}' ssh -o StrictHostKeyChecking=no -p ${port} ${user}@${host} '${remote}'`;
    } else {
      command = `ssh -o StrictHostKeyChecking=no -p ${port} ${user}@${host} '${remote}'`;
    }

    const { exec } = await import("child_process");
    const { promisify } = await import("util");
    const execAsync = promisify(exec);

    try {
      const { stdout, stderr } = await execAsync(command, { timeout: 20 * 60 * 1000, maxBuffer: 10 * 1024 * 1024 });
      return NextResponse.json({ ok: true, stdout: stdout.slice(-4000), stderr: stderr?.slice(-2000) ?? "" });
    } catch (e: any) {
      const missing = /sshpass: command not found|sshpass.*not found/i.test(String(e?.stderr ?? "") + String(e?.message ?? ""));
      return NextResponse.json({
        ok: false,
        error: e?.message ?? "Deploy failed",
        stderr: String(e?.stderr ?? "").slice(-2000),
        manualCommand: command,
        hint: missing
          ? "sshpass is not installed on this server. Run: apt-get install -y sshpass  (or run the manual command with key auth)."
          : undefined,
      }, { status: 500 });
    }
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Internal error" }, { status: 500 });
  }
}
