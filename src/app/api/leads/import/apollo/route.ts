import { NextRequest, NextResponse } from "next/server";
import { importFromApollo } from "@/lib/leads/cipher";
import { getTenantId } from "@/lib/auth";
import { parseJsonBody } from "@/lib/api-validate";
import { leadApolloImportSchema } from "@/lib/validations";

export async function POST(request: NextRequest) {
  try {
    const tenantId = await getTenantId();
    const body = await parseJsonBody(request, leadApolloImportSchema);
    if (!body.ok) return body.response;
    const result = await importFromApollo(tenantId, body.data);
    return NextResponse.json(result);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}