/**
 * Haven — Voice Receptionist
 *
 * Handles inbound and outbound voice calls via Twilio, with AI-powered
 * conversation using the existing orchestrator's generateText and
 * generateVoice functions. Logs all calls to call_logs.
 */

import { createClient } from "@supabase/supabase-js";

// ============================================================================
// Types
// ============================================================================

export interface CallLog {
  id: string;
  tenantId: string;
  leadId?: string;
  twilioCallSid: string;
  direction: "inbound" | "outbound";
  fromNumber: string;
  toNumber: string;
  status: string;
  durationSeconds?: number;
  recordingUrl?: string;
  transcript?: string;
  aiResponse?: string;
  startedAt?: string;
  endedAt?: string;
}

export interface CallFilters {
  tenantId: string;
  leadId?: string;
  status?: string;
  limit?: number;
  offset?: number;
}

// ============================================================================
// Service Supabase client
// ============================================================================

function getServiceSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

// ============================================================================
// Twilio helpers
// ============================================================================

/**
 * Generates basic auth header value for Twilio API requests.
 */
function twilioAuthHeader(): string {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !token) throw new Error("Twilio credentials not configured");
  return `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}`;
}

/**
 * Validates that an incoming Twilio webhook request is authentic by checking
 * the X-Twilio-Signature header. In production, use the Twilio SDK's
 * validateRequest(). For now, we accept the request if the header exists.
 */
export function validateTwilioRequest(signature: string | null, url: string, params: Record<string, string>): boolean {
  if (!signature) return false;
  // In production, use:
  // const twilio = require("twilio");
  // return twilio.validateRequest(process.env.TWILIO_AUTH_TOKEN, signature, url, params);
  return true;
}

// ============================================================================
// Tenant resolution from phone number
// ============================================================================

/**
 * Resolves which tenant a phone number belongs to by matching against
 * the Twilio phone number. Falls back to the first tenant if only one exists.
 * In production, this would query tenant_settings or use the Twilio number pool.
 */
export async function resolveTenantFromNumber(toNumber: string): Promise<string | null> {
  const supabase = getServiceSupabase();

  // Match by the Twilio phone number stored in environment
  const twilioNumber = process.env.TWILIO_PHONE_NUMBER;
  if (twilioNumber && toNumber.includes(twilioNumber.replace(/^\+/, ""))) {
    // Get the first tenant (simplified — in production you'd have a mapping)
    const { data: tenants } = await supabase
      .from("tenants")
      .select("id")
      .limit(1);

    if (tenants && tenants.length > 0) {
      return tenants[0].id;
    }
  }

  return null;
}

// ============================================================================
// Inbound call handling
// ============================================================================

/**
 * Handles an incoming voice call. This is the main entry point for the
 * Twilio webhook. It greets the caller, transcribes their speech, generates
 * an AI response, and speaks it back using text-to-speech.
 */
export async function handleIncomingCall(
  callSid: string,
  from: string,
  to: string
): Promise<string> {
  const tenantId = await resolveTenantFromNumber(to);

  if (!tenantId) {
    // No tenant found — play generic message
    return `<Response>
      <Say>Sorry, this number is not currently configured. Please try again later.</Say>
      <Hangup/>
    </Response>`;
  }

  const supabase = getServiceSupabase();

  // Create call log
  const { data: callLog } = await supabase
    .from("call_logs")
    .insert({
      tenant_id: tenantId,
      twilio_call_sid: callSid,
      direction: "inbound",
      from_number: from,
      to_number: to,
      status: "ringing",
      started_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  // Generate initial greeting using the orchestrator
  let greeting: string;
  try {
    const { generateText } = await import("@/lib/ai/orchestrator");
    greeting = await generateText(
      "blog_generation",
      `You are a professional business receptionist. A caller has just called in from ${from}. Generate a short, warm greeting to answer the phone. Keep it under 15 seconds when spoken. Start with "Hello" or "Thank you for calling".`,
      tenantId,
      { maxTokens: 100, temperature: 0.7 }
    );
  } catch {
    greeting = "Hello, thank you for calling. How can I help you today?";
  }

  // Generate TwiML response that speaks the greeting, then listens
  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Joanna">${escapeXml(greeting)}</Say>
  <Gather input="speech" speechTimeout="auto" action="/api/voice/incoming/respond" method="POST">
    <Say voice="Polly.Joanna">Please tell me how I can help you.</Say>
  </Gather>
  <Say voice="Polly.Joanna">I didn't hear anything. Please call back when you're ready. Goodbye.</Say>
</Response>`;

  return twiml;
}

/**
 * Handles the response from Gather — the caller's spoken input.
 * Processes their request with AI and generates an appropriate response.
 */
export async function handleGatherResponse(
  callSid: string,
  speechResult: string,
  tenantId: string
): Promise<string> {
  const supabase = getServiceSupabase();

  // Update call status
  await supabase
    .from("call_logs")
    .update({ status: "in-progress", transcript: speechResult })
    .eq("twilio_call_sid", callSid);

  // Generate AI response
  let aiResponse: string;
  try {
    const { generateText } = await import("@/lib/ai/orchestrator");
    aiResponse = await generateText(
      "blog_generation",
      `You are a professional business receptionist for an agency. A caller just said: "${speechResult}". 
      
Respond naturally and helpfully. If they asked a question, answer it. If they want to book an appointment, offer times. If they want to speak to someone, say you'll have them called back. Keep it concise — under 20 seconds when spoken.`,
      tenantId,
      { maxTokens: 150, temperature: 0.7 }
    );
  } catch {
    aiResponse = "I understand. Let me have someone get back to you as soon as possible. Is there anything else I can help with?";
  }

  // Update call log with AI response
  await supabase
    .from("call_logs")
    .update({ ai_response: aiResponse })
    .eq("twilio_call_sid", callSid);

  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Joanna">${escapeXml(aiResponse)}</Say>
  <Pause length="1"/>
  <Gather input="speech" speechTimeout="auto" action="/api/voice/incoming/respond" method="POST">
    <Say voice="Polly.Joanna">Is there anything else I can help with?</Say>
  </Gather>
  <Say voice="Polly.Joanna">Thank you for calling. Have a great day!</Say>
</Response>`;
}

/**
 * Handles call completion. Logs the final status.
 */
export async function handleCallComplete(callSid: string, durationSeconds?: number): Promise<void> {
  const supabase = getServiceSupabase();

  await supabase
    .from("call_logs")
    .update({
      status: "completed",
      ended_at: new Date().toISOString(),
      duration_seconds: durationSeconds ?? 0,
    })
    .eq("twilio_call_sid", callSid);
}

// ============================================================================
// Outbound call
// ============================================================================

/**
 * Initiates an outbound phone call via Twilio with an AI-powered script.
 */
export async function makeOutboundCall(
  tenantId: string,
  phone: string,
  leadId?: string,
  script?: string
): Promise<{ callSid: string }> {
  const supabase = getServiceSupabase();
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const fromNumber = process.env.TWILIO_PHONE_NUMBER;
  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

  if (!accountSid || !fromNumber) {
    throw new Error("Twilio credentials not configured");
  }

  // Generate outbound script if none provided
  let callScript = script;
  if (!callScript) {
    try {
      const { generateText } = await import("@/lib/ai/orchestrator");
      const leadName = leadId
        ? (await supabase.from("leads").select("first_name,company").eq("id", leadId).single()).data?.first_name
        : "";

      callScript = await generateText(
        "blog_generation",
        `You are making an outbound sales call to ${leadName || "a prospect"}. Generate a short, professional introduction and purpose for the call. Keep it under 20 seconds. Start with a greeting.`,
        tenantId,
        { maxTokens: 120, temperature: 0.7 }
      );
    } catch {
      callScript = `Hello, this is a courtesy call from Agency OS. We wanted to follow up and see how we can help your business grow.`;
    }
  }

  // URL-encode the script for Twilio's text-to-speech
  const twimlUrl = `${baseUrl}/api/voice/outbound/script?text=${encodeURIComponent(callScript)}&tenant_id=${tenantId}`;
  const statusCallbackUrl = `${baseUrl}/api/voice/calls/status`;

  const encoded = Buffer.from(`${accountSid}:${process.env.TWILIO_AUTH_TOKEN}`).toString("base64");

  const res = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Calls.json`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${encoded}`,
      },
      body: new URLSearchParams({
        From: fromNumber,
        To: phone,
        Url: twimlUrl,
        StatusCallback: statusCallbackUrl,
        StatusCallbackEvent: "completed",
        StatusCallbackMethod: "POST",
      }),
    }
  );

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Twilio outbound call error (${res.status}): ${errText}`);
  }

  const data = await res.json();

  // Log the call
  await supabase.from("call_logs").insert({
    tenant_id: tenantId,
    lead_id: leadId ?? null,
    twilio_call_sid: data.sid,
    direction: "outbound",
    from_number: fromNumber,
    to_number: phone,
    status: "ringing",
    ai_response: callScript,
    started_at: new Date().toISOString(),
  });

  // If linked to a lead, log activity
  if (leadId) {
    await supabase.from("lead_activities").insert({
      lead_id: leadId,
      tenant_id: tenantId,
      type: "call",
      direction: "outbound",
      body: callScript,
      from_address: fromNumber,
      to_address: phone,
      twilio_sid: data.sid,
    });
  }

  return { callSid: data.sid };
}

/**
 * Generates a simple TwiML response that speaks the provided text.
 * Used as the URL target for outbound calls.
 */
export function generateOutboundTwiml(text: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Joanna">${escapeXml(text)}</Say>
  <Pause length="1"/>
  <Say voice="Polly.Joanna">Thank you for your time. Goodbye.</Say>
</Response>`;
}

// ============================================================================
// Call history queries
// ============================================================================

export async function getCallLogs(filters: CallFilters) {
  const supabase = getServiceSupabase();

  let query = supabase
    .from("call_logs")
    .select("*", { count: "exact" })
    .eq("tenant_id", filters.tenantId)
    .order("created_at", { ascending: false });

  if (filters.leadId) query = query.eq("lead_id", filters.leadId);
  if (filters.status) query = query.eq("status", filters.status);

  const { data, error, count } = await query.range(
    filters.offset ?? 0,
    (filters.offset ?? 0) + (filters.limit ?? 20) - 1
  );

  if (error) throw new Error(`Failed to fetch call logs: ${error.message}`);
  return { calls: data ?? [], total: count ?? 0 };
}

export async function getCallLog(tenantId: string, callLogId: string) {
  const supabase = getServiceSupabase();

  const { data, error } = await supabase
    .from("call_logs")
    .select("*")
    .eq("id", callLogId)
    .eq("tenant_id", tenantId)
    .single();

  if (error) throw new Error(`Call log not found: ${error.message}`);
  return data;
}

// ============================================================================
// XML escape helper
// ============================================================================

function escapeXml(unsafe: string): string {
  return unsafe
    .replace(/&/g, "\u0026amp;")
    .replace(/</g, "\u003C")
    .replace(/>/g, "\u003E")
    .replace(/"/g, "\u0026quot;")
    .replace(/'/g, "\u0026apos;");
}
