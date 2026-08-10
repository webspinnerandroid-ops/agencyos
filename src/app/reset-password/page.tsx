'use client';

import { useState, useEffect } from 'react';
import { createBrowserClient } from '@supabase/ssr';
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import Link from 'next/link';

export default function ResetPasswordPage() {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');
  const [initializing, setInitializing] = useState(true);

  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  useEffect(() => {
    // Supabase appends recovery tokens to the URL hash; exchange them for a session.
    supabase.auth.getSession().then(({ data }) => {
      setInitializing(false);
    });
  }, [supabase]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }

    setLoading(true);
    const { error } = await supabase.auth.updateUser({ password });
    setLoading(false);

    if (error) {
      setError(error.message);
      return;
    }

    setDone(true);
    // Force a fresh sign-in so the middleware picks up the new session cookies.
    setTimeout(() => {
      window.location.href = '/login';
    }, 1500);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-2xl text-center">Set a new password</CardTitle>
        </CardHeader>
        <CardContent>
          {initializing ? (
            <p className="text-sm text-gray-500 text-center py-6">Checking your reset link…</p>
          ) : done ? (
            <div className="text-center space-y-4">
              <div className="mx-auto w-12 h-12 rounded-full bg-green-100 flex items-center justify-center text-green-600 text-xl font-bold">✓</div>
              <p className="text-sm text-gray-600">Password updated. Redirecting to sign in…</p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <Label htmlFor="password">New password</Label>
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  placeholder="Min 8 characters"
                />
              </div>
              <div>
                <Label htmlFor="confirm">Confirm password</Label>
                <Input
                  id="confirm"
                  type="password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  required
                />
              </div>
              {error && <p className="text-red-500 text-sm">{error}</p>}
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? 'Updating...' : 'Update password'}
              </Button>
            </form>
          )}
        </CardContent>
        <CardFooter className="flex justify-center text-sm text-gray-500">
          <Link href="/login" className="hover:text-gray-900 transition-colors">Back to sign in</Link>
        </CardFooter>
      </Card>
    </div>
  );
}