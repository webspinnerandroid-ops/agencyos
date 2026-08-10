import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { syncInbox } from "@/lib/inbox/archer";
import { getTenantId } from "@/lib/auth";

function getServiceSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function GET(request: NextRequest) {
  try {
    const tenantId = await getTenantId();
    const supabase = getServiceSupabase();

    const { data: accounts, error } = await supabase
      .from("email_accounts")
      .select("id, email_address, account_name, platform, last_synced_at")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false });

    if (error) throw new Error(error.message);

    return NextResponse.json({ accounts: accounts ?? [] });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const tenantId = await getTenantId();
    const { accountId } = await request.json();

    if (!accountId) {
      return NextResponse.json({ error: "accountId is required" }, { status: 400 });
    }

    const result = await syncInbox(accountId, tenantId);

    return NextResponse.json(result);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}