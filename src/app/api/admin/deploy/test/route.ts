import { NextRequest, NextResponse } from "next/server";
import { getTenantId, getUserId } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";

/**
 * POST /api/admin/deploy/test
 * Body: { ssh_host, ssh_port, ssh_user, ssh_password, app_path?, service_name? }
 *
 * Connects to the VPS over SSH (password or agent auth) with a short timeout
 * and:
 *  1. verifies the connection works ("test ok"),
 *  2. auto-detects the app directory (common paths + the running process's
 *     cwd) and the process name (pm2 list / running next-server process).
 *
 * Returns { ok, stdout, appPath, serviceName } — the page auto-fills the
 * detected values so the admin doesn't have to guess.
 */
export async function POST(request: NextRequest) {
  try {
    const tenantId = await getTenantId();
    const userId = await getUserId();
    if (!tenantId || !userId) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }
    const supabase = await createServiceClient();
    const { data: roles } = await supabase
      .from("user_roles")
      .select("role")
      .eq("tenant_id", tenantId)
      .eq("user_id", userId);
    if (!(roles ?? []).some((r: any) => r.role === "super_admin")) {
      return NextResponse.json({ error: "Super admin access required" }, { status: 403 });
    }

    const body = (await request.json().catch(() => ({}))) as Record<string, string>;
    const host = String(body.ssh_host ?? "").trim();
    const user = String(body.ssh_user ?? "root").trim();
    const pass = String(body.ssh_password ?? "").trim();
    const port = String(body.ssh_port ?? "22").trim() || "22";

    if (!host || !user) {
      return NextResponse.json({ error: "SSH host and user are required" }, { status: 400 });
    }

    // Probe: echo ok, then detect the app path (running process cwd first,
    // then common layouts) and the pm2 process / next-server process name.
    const remote = [
      "echo TEST_OK",
      "APP_PATH=$(readlink -f /proc/$(pgrep -f next-server | head -1)/cwd 2>/dev/null || true)",
      "[ -z \"$APP_PATH\" ] && APP_PATH=$(ls -d /var/www/*/*/agency-os /var/www/*/agency-os /srv/*/agency-os /home/*/agency-os 2>/dev/null | head -1) || true",
      "[ -n \"$APP_PATH\" ] && echo \"APP_PATH=$APP_PATH\"",
      "SVC=$(pm2 jlist 2>/dev/null | grep -oE '\"name\":\"[^\"]+\"' | head -1 | sed 's/\"name\":\"//;s/\"//' || true)",
      "[ -z \"$SVC\" ] && SVC=$(ps -o comm= -p $(pgrep -f next-server | head -1) 2>/dev/null | head -1) || true",
      "[ -n \"$SVC\" ] && echo \"SERVICE=$SVC\"",
    ].join("; ");

    const sshBase = `ssh -o StrictHostKeyChecking=no -o ConnectTimeout=8 -p ${port} ${user}@${host}`;
    const command = pass
      ? `sshpass -p '${pass.replace(/'/g, "'\\''")}' ${sshBase} '${remote}'`
      : `${sshBase} '${remote}'`;

    const { exec } = await import("child_process");
    const { promisify } = await import("util");
    const execAsync = promisify(exec);

    try {
      const { stdout, stderr } = await execAsync(command, { timeout: 30_000, maxBuffer: 2 * 1024 * 1024 });
      const out = String(stdout ?? "");
      const appPathMatch = out.match(/APP_PATH=(.+)/);
      const serviceMatch = out.match(/SERVICE=(.+)/);
      return NextResponse.json({
        ok: out.includes("TEST_OK"),
        stdout: (out + (stderr ? `\nstderr: ${stderr}` : "")).slice(-2000),
        appPath: appPathMatch?.[1]?.trim() ?? null,
        serviceName: serviceMatch?.[1]?.trim() ?? null,
      });
    } catch (e: any) {
      const missing = /sshpass: command not found/i.test(String(e?.stderr ?? "") + String(e?.message ?? ""));
      return NextResponse.json({
        ok: false,
        error: missing
          ? "sshpass is not installed on this server — install it (apt install sshpass) or use key-based auth."
          : String(e?.stderr || e?.message || "SSH connection failed").slice(0, 800),
      }, { status: 502 });
    }
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Internal error" }, { status: 500 });
  }
}
