'use client';

import { useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { createBrowserClient } from '@supabase/ssr';
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import Link from 'next/link';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [notConfirmed, setNotConfirmed] = useState(false);
  const [resending, setResending] = useState(false);
  const [resent, setResent] = useState(false);
  // Two-factor: after a successful password sign-in, a TOTP step appears
  // when the account has an authenticator app enrolled.
  const [step, setStep] = useState<"password" | "totp">("password");
  const [totpCode, setTotpCode] = useState("");
  const [totpError, setTotpError] = useState("");
  const [totpLoading, setTotpLoading] = useState(false);

  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  const handleTotp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!/^\d{6}$/.test(totpCode.trim())) {
      setTotpError("Enter the 6-digit code from your authenticator app.");
      return;
    }
    setTotpLoading(true);
    setTotpError("");
    try {
      const res = await fetch("/api/auth/2fa/verify", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: totpCode.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        setTotpError(data.error ?? "Invalid code — try again.");
        setTotpLoading(false);
        return;
      }
      window.location.href = "/dashboard";
    } catch (err: any) {
      setTotpError(err.message ?? "Verification failed");
      setTotpLoading(false);
    }
  };

  const resendConfirmation = async () => {
    setResending(true);
    setResent(false);
    try {
      await fetch("/api/auth/resend-confirmation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      setResent(true);
    } finally {
      setResending(false);
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setNotConfirmed(false);
    setResent(false);
    setLoading(true);

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      const unconfirmed = /not confirmed|confirm your email/i.test(error.message);
      setNotConfirmed(unconfirmed);
      setError(unconfirmed ? "Please confirm your email address before signing in." : error.message);
      setLoading(false);
      return;
    }

    // Password is correct — check whether 2FA is enrolled before entering.
    try {
      const res = await fetch("/api/auth/2fa/status", { credentials: "include" });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.enrolled) {
        setStep("totp");
        setLoading(false);
        return;
      }
    } catch {
      // Fall through to the dashboard if the status check fails.
    }
    // Use hard navigation so middleware can read fresh cookies
    window.location.href = '/dashboard';
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-2xl text-center">Sign in to Agency OS</CardTitle>
        </CardHeader>
        <CardContent>
          {step === "totp" ? (
            <form onSubmit={handleTotp} className="space-y-4">
              <div className="text-center">
                <div className="mx-auto w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center mb-3">
                  <ShieldCheck className="size-7 text-primary" />
                </div>
                <h3 className="font-semibold">Two-factor authentication</h3>
                <p className="text-sm text-muted-foreground mt-1">
                  Enter the 6-digit code from your authenticator app.
                </p>
              </div>
              <div>
                <Label htmlFor="totp">Authenticator code</Label>
                <Input
                  id="totp"
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  value={totpCode}
                  onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, ""))}
                  required
                  placeholder="000000"
                  className="text-center text-2xl tracking-[0.5em] font-mono"
                />
              </div>
              {totpError && <p className="text-red-500 text-sm">{totpError}</p>}
              <Button type="submit" className="w-full" disabled={totpLoading}>
                {totpLoading ? "Verifying…" : "Verify & Sign In"}
              </Button>
              <button
                type="button"
                onClick={() => { setStep("password"); setTotpCode(""); setTotpError(""); }}
                className="w-full text-center text-xs text-muted-foreground hover:underline"
              >
                Back to password
              </button>
            </form>
          ) : (
          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                placeholder="you@example.com"
              />
            </div>
            <div>
              <div className="flex items-center justify-between">
                <Label htmlFor="password">Password</Label>
                <Link href="/forgot-password" className="text-xs text-primary hover:underline">
                  Forgot password?
                </Link>
              </div>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            {error && <p className="text-red-500 text-sm">{error}</p>}
            {notConfirmed && (
              <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm">
                <p className="text-amber-800">Check your inbox for the confirmation email.</p>
                {resent ? (
                  <p className="text-green-700 mt-1">Confirmation email re-sent — check your inbox.</p>
                ) : (
                  <button
                    type="button"
                    onClick={resendConfirmation}
                    disabled={resending}
                    className="mt-1 text-primary underline disabled:opacity-50"
                  >
                    {resending ? "Sending…" : "Resend confirmation email"}
                  </button>
                )}
              </div>
            )}
            <Button type="submit" className="w-full bg-primary text-primary-foreground" disabled={loading}>
              {loading ? 'Signing in...' : 'Sign In'}
            </Button>
          </form>
          )}
        </CardContent>
        <CardFooter className="flex flex-col gap-2 text-sm text-gray-500">
          <span>
            New to Agency OS?{' '}
            <Link href="/register" className="text-primary font-medium hover:underline">
              Create an account
            </Link>
          </span>
          <Link href="/help" className="hover:text-gray-900 transition-colors">Help Center</Link>
        </CardFooter>
      </Card>
    </div>
  );
}