/**
 * Cipher — Lead Intelligence & CRM
 *
 * Handles lead enrichment via Apollo, outbound email via Resend,
 * outbound SMS via Twilio, and sequence automation.
 */

import { createClient } from "@supabase/supabase-js";

// ============================================================================
// Types
// ============================================================================

export interface LeadInput {
  email?: string;
  firstName?: string;
  lastName?: string;
  company?: string;
  title?: string;
  phone?: string;
  linkedinUrl?: string;
  source?: string;
  clientId?: string;
  notes?: string;
}

export interface LeadFilters {
  tenantId: string;
  status?: string;
  source?: string;
  clientId?: string;
  search?: string;
  limit?: number;
  offset?: number;
}

export interface ApolloPerson {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  company_name: string;
  title: string;
  phone: string;
  linkedin_url: string;
  city?: string;
  state?: string;
  country?: string;
  seniority?: string;
  departments?: string[];
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
// Lead CRUD
// ============================================================================

export async function createLead(
  tenantId: string,
  input: LeadInput
): Promise<{ id: string }> {
  const supabase = getServiceSupabase();

  const { data, error } = await supabase
    .from("leads")
    .insert({
      tenant_id: tenantId,
      client_id: input.clientId ?? null,
      email: input.email,
      first_name: input.firstName,
      last_name: input.lastName,
      company: input.company,
      title: input.title,
      phone: input.phone,
      linkedin_url: input.linkedinUrl,
      source: input.source ?? "manual",
      notes: input.notes,
    })
    .select("id")
    .single();

  if (error) throw new Error(`Failed to create lead: ${error.message}`);
  return { id: data.id };
}

export async function getLeads(filters: LeadFilters) {
  const supabase = getServiceSupabase();

  let query = supabase
    .from("leads")
    .select("*", { count: "exact" })
    .eq("tenant_id", filters.tenantId)
    .order("created_at", { ascending: false });

  if (filters.status) query = query.eq("status", filters.status);
  if (filters.source) query = query.eq("source", filters.source);
  if (filters.clientId) query = query.eq("client_id", filters.clientId);
  if (filters.search) {
    query = query.or(
      `first_name.ilike.%${filters.search}%,last_name.ilike.%${filters.search}%,email.ilike.%${filters.search}%,company.ilike.%${filters.search}%`
    );
  }

  const { data, error, count } = await query.range(
    filters.offset ?? 0,
    (filters.offset ?? 0) + (filters.limit ?? 20) - 1
  );

  if (error) throw new Error(`Failed to fetch leads: ${error.message}`);
  return { leads: data ?? [], total: count ?? 0 };
}

export async function getLead(tenantId: string, leadId: string) {
  const supabase = getServiceSupabase();

  const { data, error } = await supabase
    .from("leads")
    .select("*")
    .eq("id", leadId)
    .eq("tenant_id", tenantId)
    .single();

  if (error) throw new Error(`Lead not found: ${error.message}`);
  return data;
}

export async function updateLead(
  tenantId: string,
  leadId: string,
  input: Partial<LeadInput & { status: string; assignedTo: string }>
) {
  const supabase = getServiceSupabase();

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (input.email !== undefined) updates.email = input.email;
  if (input.firstName !== undefined) updates.first_name = input.firstName;
  if (input.lastName !== undefined) updates.last_name = input.lastName;
  if (input.company !== undefined) updates.company = input.company;
  if (input.title !== undefined) updates.title = input.title;
  if (input.phone !== undefined) updates.phone = input.phone;
  if (input.linkedinUrl !== undefined) updates.linkedin_url = input.linkedinUrl;
  if (input.status !== undefined) updates.status = input.status;
  if (input.notes !== undefined) updates.notes = input.notes;
  if (input.clientId !== undefined) updates.client_id = input.clientId;

  const { error } = await supabase
    .from("leads")
    .update(updates)
    .eq("id", leadId)
    .eq("tenant_id", tenantId);

  if (error) throw new Error(`Failed to update lead: ${error.message}`);

  // Log status change
  if (input.status) {
    await supabase.from("lead_activities").insert({
      lead_id: leadId,
      tenant_id: tenantId,
      type: "status_change",
      body: `Status changed to ${input.status}`,
    });
  }
}

export async function deleteLead(tenantId: string, leadId: string) {
  const supabase = getServiceSupabase();

  const { error } = await supabase
    .from("leads")
    .delete()
    .eq("id", leadId)
    .eq("tenant_id", tenantId);

  if (error) throw new Error(`Failed to delete lead: ${error.message}`);
}

// ============================================================================
// Apollo Enrichment
// ============================================================================

export async function enrichLead(
  tenantId: string,
  leadId: string
): Promise<{ enriched: boolean; data?: ApolloPerson }> {
  const supabase = getServiceSupabase();
  const apiKey = process.env.APOLLO_API_KEY;

  if (!apiKey) {
    throw new Error("APOLLO_API_KEY not configured");
  }

  const { data: lead, error: leadErr } = await supabase
    .from("leads")
    .select("email, first_name, last_name, company")
    .eq("id", leadId)
    .eq("tenant_id", tenantId)
    .single();

  if (leadErr || !lead) {
    throw new Error(`Lead ${leadId} not found`);
  }

  // Match by email if available, otherwise by name + company
  const params: Record<string, string> = {};
  if (lead.email) {
    params.email = lead.email;
  } else {
    params.first_name = lead.first_name ?? "";
    params.last_name = lead.last_name ?? "";
    if (lead.company) params.organization_name = lead.company;
  }

  const query = new URLSearchParams(params).toString();
  const res = await fetch(
    `https://api.apollo.io/v1/people/match?${query}`,
    {
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-cache",
        "X-Api-Key": apiKey,
      },
    }
  );

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Apollo API error (${res.status}): ${errText}`);
  }

  const data = await res.json();
  const person = data.person;

  if (!person) {
    return { enriched: false };
  }

  // Update the lead with Apollo data
  await supabase
    .from("leads")
    .update({
      first_name: person.first_name ?? lead.first_name,
      last_name: person.last_name ?? lead.last_name,
      email: person.email ?? lead.email,
      company: person.organization?.name ?? lead.company,
      title: person.title,
      phone: person.phone_numbers?.[0]?.sanitized_number,
      linkedin_url: person.linkedin_url,
      enrichment_data: person,
      apollo_enriched: true,
      updated_at: new Date().toISOString(),
    })
    .eq("id", leadId);

  await supabase.from("lead_activities").insert({
    lead_id: leadId,
    tenant_id: tenantId,
    type: "note",
    body: "Apollo enrichment completed",
  });

  return {
    enriched: true,
    data: {
      id: person.id,
      email: person.email,
      first_name: person.first_name,
      last_name: person.last_name,
      company_name: person.organization?.name,
      title: person.title,
      phone: person.phone_numbers?.[0]?.sanitized_number,
      linkedin_url: person.linkedin_url,
      city: person.city,
      state: person.state,
      country: person.country,
      seniority: person.seniority,
      departments: person.departments,
    },
  };
}

export async function importFromApollo(
  tenantId: string,
  searchParams: {
    q_organization_name?: string;
    q_title?: string;
    q_keywords?: string;
    page?: number;
    per_page?: number;
  }
): Promise<{ imported: number; totalAvailable: number }> {
  const supabase = getServiceSupabase();
  const apiKey = process.env.APOLLO_API_KEY;

  if (!apiKey) {
    throw new Error("APOLLO_API_KEY not configured");
  }

  const params: Record<string, string> = {
    page: String(searchParams.page ?? 1),
    per_page: String(searchParams.per_page ?? 25),
  };
  if (searchParams.q_organization_name) params.q_organization_name = searchParams.q_organization_name;
  if (searchParams.q_title) params.q_title = searchParams.q_title;
  if (searchParams.q_keywords) params.q_keywords = searchParams.q_keywords;

  if (!params.q_organization_name && !params.q_title && !params.q_keywords) {
    throw new Error("At least one search parameter is required (q_organization_name, q_title, or q_keywords)");
  }

  const query = new URLSearchParams(params).toString();
  const res = await fetch(
    `https://api.apollo.io/v1/mixed_people/search?${query}`,
    {
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-cache",
        "X-Api-Key": apiKey,
      },
    }
  );

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Apollo search error (${res.status}): ${errText}`);
  }

  const data = await res.json();
  const people = data.people ?? [];
  let imported = 0;

  for (const person of people) {
    const { error: insertErr } = await supabase.from("leads").upsert(
      {
        tenant_id: tenantId,
        email: person.email,
        first_name: person.first_name,
        last_name: person.last_name,
        company: person.organization_name ?? person.organization?.name,
        title: person.title,
        phone: person.phone_numbers?.[0]?.sanitized_number,
        linkedin_url: person.linkedin_url,
        source: "apollo",
        status: "new",
        enrichment_data: person,
        apollo_enriched: true,
      },
      { onConflict: "tenant_id,email", ignoreDuplicates: false }
    );

    if (!insertErr) imported++;
  }

  return {
    imported,
    totalAvailable: data.pagination?.total_entries ?? people.length,
  };
}

// ============================================================================
// Email via Resend
// ============================================================================

export async function sendEmail(
  tenantId: string,
  leadId: string,
  subject: string,
  body: string
): Promise<{ sent: boolean; resendId?: string }> {
  const supabase = getServiceSupabase();
  const apiKey = process.env.RESEND_API_KEY;

  if (!apiKey) {
    throw new Error("RESEND_API_KEY not configured");
  }

  const { data: lead, error: leadErr } = await supabase
    .from("leads")
    .select("email, first_name, last_name")
    .eq("id", leadId)
    .eq("tenant_id", tenantId)
    .single();

  if (leadErr || !lead || !lead.email) {
    throw new Error("Lead not found or missing email");
  }

  const fromEmail = process.env.RESEND_FROM_EMAIL ?? "agency@updates.yourdomain.com";

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      from: fromEmail,
      to: [lead.email],
      subject,
      html: body,
      tags: [{ name: "lead_id", value: leadId }],
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Resend API error (${res.status}): ${errText}`);
  }

  const data = await res.json();

  await supabase.from("lead_activities").insert({
    lead_id: leadId,
    tenant_id: tenantId,
    type: "email",
    direction: "outbound",
    subject,
    body,
    from_address: fromEmail,
    to_address: lead.email,
    resend_id: data.id,
  });

  return { sent: true, resendId: data.id };
}

// ============================================================================
// SMS via Twilio
// ============================================================================

export async function sendSMS(
  tenantId: string,
  leadId: string,
  body: string
): Promise<{ sent: boolean; twilioSid?: string }> {
  const supabase = getServiceSupabase();
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const fromNumber = process.env.TWILIO_PHONE_NUMBER;

  if (!accountSid || !authToken || !fromNumber) {
    throw new Error("Twilio credentials not configured");
  }

  const { data: lead, error: leadErr } = await supabase
    .from("leads")
    .select("phone, first_name")
    .eq("id", leadId)
    .eq("tenant_id", tenantId)
    .single();

  if (leadErr || !lead || !lead.phone) {
    throw new Error("Lead not found or missing phone number");
  }

  const encoded = Buffer.from(`${accountSid}:${authToken}`).toString("base64");

  const res = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${encoded}`,
      },
      body: new URLSearchParams({
        From: fromNumber,
        To: lead.phone,
        Body: body,
      }),
    }
  );

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Twilio API error (${res.status}): ${errText}`);
  }

  const data = await res.json();

  await supabase.from("lead_activities").insert({
    lead_id: leadId,
    tenant_id: tenantId,
    type: "sms",
    direction: "outbound",
    body,
    from_address: fromNumber,
    to_address: lead.phone,
    twilio_sid: data.sid,
  });

  return { sent: true, twilioSid: data.sid };
}

// ============================================================================
// Sequence Automation
// ============================================================================

interface SequenceStep {
  delay_days: number;
  channel: "email" | "sms";
  subject?: string;
  body_template: string;
}

export async function processSequenceStep(enrollmentId: string): Promise<{
  processed: boolean;
  stepIndex?: number;
  action?: string;
}> {
  const supabase = getServiceSupabase();

  const { data: enrollment, error: enrErr } = await supabase
    .from("sequence_enrollments")
    .select("id, lead_id, sequence_id, tenant_id, current_step, paused, next_action_at, completed_at")
    .eq("id", enrollmentId)
    .single();

  if (enrErr || !enrollment) {
    throw new Error("Enrollment not found");
  }

  if (enrollment.paused || enrollment.completed_at) {
    return { processed: false };
  }

  const now = new Date();
  if (enrollment.next_action_at && new Date(enrollment.next_action_at) > now) {
    return { processed: false };
  }

  const { data: sequence, error: seqErr } = await supabase
    .from("sequences")
    .select("steps")
    .eq("id", enrollment.sequence_id)
    .single();

  if (seqErr || !sequence) {
    throw new Error("Sequence not found");
  }

  const steps: SequenceStep[] = sequence.steps ?? [];
  if (enrollment.current_step >= steps.length) {
    // Sequence complete
    await supabase
      .from("sequence_enrollments")
      .update({ completed_at: now.toISOString() })
      .eq("id", enrollmentId);
    return { processed: false };
  }

  const step = steps[enrollment.current_step];
  const { data: lead } = await supabase
    .from("leads")
    .select("first_name, last_name, email, phone, company")
    .eq("id", enrollment.lead_id)
    .single();

  if (!lead) return { processed: false };

  // Personalize body template
  const bodyText = step.body_template
    .replace(/{{first_name}}/g, lead.first_name ?? "")
    .replace(/{{last_name}}/g, lead.last_name ?? "")
    .replace(/{{company}}/g, lead.company ?? "")
    .replace(/{{email}}/g, lead.email ?? "");

  try {
    if (step.channel === "email") {
      await sendEmail(enrollment.tenant_id, enrollment.lead_id, step.subject ?? "Follow up", bodyText);
    } else if (step.channel === "sms") {
      await sendSMS(enrollment.tenant_id, enrollment.lead_id, bodyText);
    }
  } catch (err: any) {
    console.error(`[Cipher] Sequence step failed for enrollment ${enrollmentId}:`, err.message);
    return { processed: false };
  }

  // Advance to next step
  const nextStep = enrollment.current_step + 1;
  const nextDelay = nextStep < steps.length ? steps[nextStep]?.delay_days ?? 1 : 0;
  const nextActionAt = new Date(now.getTime() + nextDelay * 86400000).toISOString();

  await supabase
    .from("sequence_enrollments")
    .update({
      current_step: nextStep,
      next_action_at: nextActionAt,
    })
    .eq("id", enrollmentId);

  return {
    processed: true,
    stepIndex: enrollment.current_step,
    action: `${step.channel} sent`,
  };
}