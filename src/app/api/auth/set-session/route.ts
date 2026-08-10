import { NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

export async function POST() {
  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name) {
          return cookieStore.get(name)?.value;
        },
        set(name, value, options) {
          cookieStore.set({ name, value, ...options });
        },
        remove(name, options) {
          cookieStore.set({ name, value: '', ...options });
        },
      },
    }
  );

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  // Use service role to fetch user role
  const serviceClient = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      cookies: {
        get() { return undefined; },
        set() {},
        remove() {},
      },
    }
  );

  const { data: userRole } = await serviceClient
    .from('user_roles')
    .select('tenant_id, role')
    .eq('user_id', user.id)
    .single();

  if (!userRole) {
    return NextResponse.json({ error: 'No tenant assigned. Please contact support.' }, { status: 403 });
  }

  const response = NextResponse.json({ success: true });

  response.cookies.set('x-tenant-id', userRole.tenant_id, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
  });
  response.cookies.set('x-user-role', userRole.role, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
  });

  return response;
}