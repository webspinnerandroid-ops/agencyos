"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Rocket } from "lucide-react";

export default function AdminDeployPage() {
  const [config, setConfig] = useState<Record<string, string>>({});
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deploying, setDeploying] = useState(false);
  const [output, setOutput] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/deploy", { credentials: "include" });
      if (res.ok) {
        const data = await res.json();
        setConfig(data.config ?? {});
      } else {
        const data = await res.json().catch(() => ({}));
        if (data.error) setError(data.error);
      }
    } catch {
      // ignore
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const save = async () => {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const res = await fetch("/api/admin/deploy", {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Failed to save");
        return;
      }
      setSaved(true);
    } catch (e: any) {
      setError(e.message ?? "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  const deploy = async () => {
    setDeploying(true);
    setError(null);
    setOutput("");
    try {
      const res = await fetch("/api/admin/deploy", { method: "POST", credentials: "include" });
      const data = await res.json();
      if (res.ok) {
        setOutput(data.stdout ?? "");
      } else {
        setError(data.error ?? "Deploy failed");
        if (data.manualCommand) {
          setOutput(`Manual command (run on this machine):\n\n${data.manualCommand}\n`);
        }
        if (data.stderr) setOutput((o) => o + "\n\nstderr:\n" + data.stderr);
        if (data.hint) setOutput((o) => o + "\n\nHint: " + data.hint);
      }
    } catch (e: any) {
      setError(e.message ?? "Deploy failed");
    } finally {
      setDeploying(false);
    }
  };

  const set = (k: string, v: string) => setConfig((c) => ({ ...c, [k]: v }));

  const fields: { key: string; label: string; secret?: boolean; placeholder?: string }[] = [
    { key: "ssh_host", label: "SSH host (VPS IP or domain)" },
    { key: "ssh_port", label: "SSH port", placeholder: "22" },
    { key: "ssh_user", label: "SSH user", placeholder: "root" },
    { key: "ssh_password", label: "SSH password (optional — key auth also works)", secret: true },
    { key: "app_path", label: "App path on server (e.g. /var/www/agency-os)", placeholder: "/var/www/agency-os" },
    { key: "service_name", label: "Process name for pm2 restart", placeholder: "agency-os" },
  ];

  if (!loaded) {
    return <div className="p-6"><Loader2 className="size-6 animate-spin text-muted-foreground" /></div>;
  }

  return (
    <div className="p-6 max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Deploy from the App</h1>
        <p className="text-muted-foreground mt-1">
          Save the VPS SSH details once, then deploy the latest committed code
          with one click. The server runs <code className="text-xs bg-muted px-1 rounded">git pull → npm install → build → pm2 restart</code>.
        </p>
      </div>

      {error && <div className="p-3 rounded-md bg-red-50 text-red-700 border border-red-200 text-sm">{error}</div>}
      {saved && <div className="p-3 rounded-md bg-green-50 text-green-700 border border-green-200 text-sm">SSH settings saved (secrets encrypted).</div>}

      <Card className="p-5 space-y-4">
        {fields.map((f) => (
          <div key={f.key}>
            <Label>{f.label}</Label>
            <Input
              type={f.secret ? "password" : "text"}
              value={config[f.key] ?? ""}
              placeholder={f.placeholder}
              onChange={(e) => set(f.key, e.target.value)}
              className="mt-1"
            />
          </div>
        ))}
        <div className="flex items-center gap-3">
          <Button onClick={save} disabled={saving}>
            {saving ? <Loader2 className="size-4 animate-spin mr-1" /> : null} Save SSH settings
          </Button>
          <Button variant="default" onClick={deploy} disabled={deploying || !config.ssh_host || !config.app_path}>
            {deploying ? <Loader2 className="size-4 animate-spin mr-1" /> : <Rocket className="size-4 mr-1" />}
            {deploying ? "Deploying…" : "Deploy now"}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Password is stored encrypted and never shown again (displayed as dots). Deploy can take several minutes — build output appears below.
        </p>
      </Card>

      {output && (
        <Card className="p-4">
          <h2 className="text-sm font-semibold mb-2">Deploy output</h2>
          <pre className="whitespace-pre-wrap text-xs bg-muted/50 rounded-md p-3 max-h-96 overflow-y-auto">{output}</pre>
        </Card>
      )}
    </div>
  );
}
