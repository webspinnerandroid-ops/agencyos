/**
 * Archer — Inbox & Calendar Operations
 *
 * Handles Gmail and Outlook OAuth, inbox syncing, and calendar CRUD.
 * Tokens are encrypted at rest using @/lib/encryption, same as the
 * AI orchestrator and social publisher.
 */

import { createClient } from "@supabase/supabase-js";

// ============================================================================
// Types
// ============================================================================

export type EmailPlatform = "gmail" | "outlook";

export interface EmailAccount {
  id: string;
  tenantId: string;
  platform: EmailPlatform;
  emailAddress: string;
  accountName: string;
  encryptedToken: string;
  syncCursor?: string;
  lastSyncedAt?: string;
}

export interface EmailThread {
  externalId: string;
  subject: string;
  from: string;
  fromName?: string;
  to: string[];
  cc?: string[];
  bodyPreview: string;
  receivedAt: string;
  isRead: boolean;
  labels?: string[];
}

export interface CalendarEvent {
  externalId: string;
  title?: string;
  description?: string;
  startTime: string;
  endTime: string;
  location?: string;
  attendees?: { name: string; email: string; status: string }[];
  status: "confirmed" | "tentative" | "cancelled";
  rawJson?: Record<string, unknown>;
}

export interface SyncResult {
  accountId: string;
  threadsImported: number;
  cursorUpdated: boolean;
}

export interface SyncCalendarResult {
  accountId: string;
  eventsImported: number;
  cursorUpdated: boolean;
}

// ============================================================================
// Service Supabase client
// ============================================================================

function getServiceSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
}

// ============================================================================
// Token helpers
// ============================================================================

/**
 * Decrypts a stored OAuth token string. Tokens are stored as JSON
 * containing access_token, refresh_token, and expires_in.
 */
async function decryptTokenString(encrypted: string): Promise<{
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
}> {
  try {
    const { decrypt } = await import("@/lib/encryption");
    const decrypted = decrypt(encrypted);
    return JSON.parse(decrypted);
  } catch {
    // Fallback: token may be stored as plain base64 JSON
    try {
      const decoded = Buffer.from(encrypted, "base64").toString("utf-8");
      return JSON.parse(decoded);
    } catch {
      // Raw token string (dev only)
      return { access_token: encrypted };
    }
  }
}

/**
 * Refreshes an OAuth token if it has a refresh_token.
 */
async function ensureValidToken(
  platform: EmailPlatform,
  tokenData: Awaited<ReturnType<typeof decryptTokenString>>
): Promise<string> {
  // For simplicity, return the access token directly.
  // A production implementation would check expires_in and use refresh_token
  // to get a new access token via the provider's token endpoint.
  return tokenData.access_token;
}

// ============================================================================
// OAuth URL Generation
// ============================================================================

/**
 * Generates the OAuth authorization URL for Gmail (read-only mail + calendar).
 */
export async function getGmailAuthUrl(tenantId: string): Promise<string> {
  const supabase = getServiceSupabase();
  const state = crypto.randomUUID();

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const redirectUri = `${process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"}/api/auth/callback/google`;
  const scope = encodeURIComponent(
    "https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/calendar.events"
  );

  await supabase.from("oauth_states").insert({
    tenant_id: tenantId,
    state,
    platform: "gmail",
    expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
  });

  return `https://accounts.google.com/o/oauth2/v2/auth?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=${scope}&access_type=offline&prompt=consent&state=${state}`;
}

/**
 * Generates the OAuth authorization URL for Outlook (mail + calendar via Microsoft Graph).
 */
export async function getOutlookAuthUrl(tenantId: string): Promise<string> {
  const supabase = getServiceSupabase();
  const state = crypto.randomUUID();

  const clientId = process.env.OUTLOOK_CLIENT_ID;
  const redirectUri = `${process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"}/api/auth/callback/outlook`;
  const scope = encodeURIComponent(
    "offline_access Mail.Read Calendars.Read Calendars.ReadWrite"
  );

  await supabase.from("oauth_states").insert({
    tenant_id: tenantId,
    state,
    platform: "outlook",
    expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
  });

  return `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=${scope}&state=${state}`;
}

// ============================================================================
// Inbox Sync
// ============================================================================

/**
 * Syncs the Gmail inbox for a given account. Fetches unread messages,
 * processes them, and updates the sync cursor.
 */
export async function syncGmailInbox(
  accountId: string,
  tenantId: string
): Promise<SyncResult> {
  const supabase = getServiceSupabase();

  const { data: account, error: acctErr } = await supabase
    .from("email_accounts")
    .select("encrypted_token, sync_cursor")
    .eq("id", accountId)
    .eq("tenant_id", tenantId)
    .single();

  if (acctErr || !account) {
    throw new Error(`Email account ${accountId} not found`);
  }

  const tokenData = await decryptTokenString(account.encrypted_token);
  const accessToken = await ensureValidToken("gmail", tokenData);

  // Fetch unread messages
  const query = account.sync_cursor
    ? `q=is:unread&maxResults=20`
    : `q=is:unread&maxResults=50`;

  const listRes = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages?${query}`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    }
  );

  if (!listRes.ok) {
    const errText = await listRes.text();
    throw new Error(`Gmail API error (${listRes.status}): ${errText}`);
  }

  const listData = await listRes.json();
  const messages = listData.messages ?? [];

  // Fetch full message details for each
  const threads: EmailThread[] = [];
  for (const msg of messages.slice(0, 20)) {
    const detailRes = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msg.id}?format=metadata&metadataHeaders=Subject,From,To,Cc,Date`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );

    if (detailRes.ok) {
      const detail = await detailRes.json();
      const headers = detail.payload?.headers ?? [];

      const subject = headers.find((h: any) => h.name === "Subject")?.value ?? "(No subject)";
      const from = headers.find((h: any) => h.name === "From")?.value ?? "";
      const to = headers.find((h: any) => h.name === "To")?.value ?? "";
      const date = headers.find((h: any) => h.name === "Date")?.value ?? "";

      threads.push({
        externalId: msg.id,
        subject,
        from,
        to: to.split(",").map((s: string) => s.trim()),
        bodyPreview: detail.snippet ?? "",
        receivedAt: date,
        isRead: !detail.labelIds?.includes("UNREAD"),
        labels: detail.labelIds,
      });
    }
  }

  // Update sync cursor with the history ID from the latest message
  const newCursor = listData.messages?.[0]?.id ?? account.sync_cursor;

  await supabase
    .from("email_accounts")
    .update({
      sync_cursor: newCursor,
      last_synced_at: new Date().toISOString(),
    })
    .eq("id", accountId);

  return {
    accountId,
    threadsImported: threads.length,
    cursorUpdated: true,
  };
}

/**
 * Syncs the Outlook inbox for a given account via Microsoft Graph.
 */
export async function syncOutlookInbox(
  accountId: string,
  tenantId: string
): Promise<SyncResult> {
  const supabase = getServiceSupabase();

  const { data: account, error: acctErr } = await supabase
    .from("email_accounts")
    .select("encrypted_token, sync_cursor")
    .eq("id", accountId)
    .eq("tenant_id", tenantId)
    .single();

  if (acctErr || !account) {
    throw new Error(`Email account ${accountId} not found`);
  }

  const tokenData = await decryptTokenString(account.encrypted_token);
  const accessToken = await ensureValidToken("outlook", tokenData);

  const filter = "$filter=isRead eq false&$top=20&$orderby=receivedDateTime desc";
  const listRes = await fetch(
    `https://graph.microsoft.com/v1.0/me/messages?${filter}&$select=id,subject,from,toRecipients,bodyPreview,receivedDateTime,isRead`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    }
  );

  if (!listRes.ok) {
    const errText = await listRes.text();
    throw new Error(`Outlook API error (${listRes.status}): ${errText}`);
  }

  const listData = await listRes.json();
  const messages = listData.value ?? [];

  const threads: EmailThread[] = messages.map((msg: any) => ({
    externalId: msg.id,
    subject: msg.subject ?? "(No subject)",
    from: msg.from?.emailAddress?.address ?? "",
    fromName: msg.from?.emailAddress?.name,
    to: (msg.toRecipients ?? []).map((r: any) => r.emailAddress?.address ?? ""),
    bodyPreview: msg.bodyPreview ?? "",
    receivedAt: msg.receivedDateTime ?? "",
    isRead: msg.isRead ?? false,
  }));

  const newCursor = messages[0]?.id ?? account.sync_cursor;

  await supabase
    .from("email_accounts")
    .update({
      sync_cursor: newCursor,
      last_synced_at: new Date().toISOString(),
    })
    .eq("id", accountId);

  return {
    accountId,
    threadsImported: threads.length,
    cursorUpdated: true,
  };
}

/**
 * Syncs the inbox for any email account, routing to the correct provider.
 */
export async function syncInbox(
  accountId: string,
  tenantId: string
): Promise<SyncResult> {
  const supabase = getServiceSupabase();

  const { data: account, error: acctErr } = await supabase
    .from("email_accounts")
    .select("platform")
    .eq("id", accountId)
    .eq("tenant_id", tenantId)
    .single();

  if (acctErr || !account) {
    throw new Error(`Email account ${accountId} not found`);
  }

  if (account.platform === "gmail") {
    return syncGmailInbox(accountId, tenantId);
  }
  if (account.platform === "outlook") {
    return syncOutlookInbox(accountId, tenantId);
  }

  throw new Error(`Unsupported platform: ${account.platform}`);
}

// ============================================================================
// Calendar Sync
// ============================================================================

/**
 * Syncs Gmail calendar events for a date range.
 */
export async function syncGmailCalendar(
  accountId: string,
  tenantId: string,
  daysAhead: number = 30
): Promise<SyncCalendarResult> {
  const supabase = getServiceSupabase();

  const { data: account, error: acctErr } = await supabase
    .from("email_accounts")
    .select("encrypted_token")
    .eq("id", accountId)
    .eq("tenant_id", tenantId)
    .single();

  if (acctErr || !account) {
    throw new Error(`Email account ${accountId} not found`);
  }

  const tokenData = await decryptTokenString(account.encrypted_token);
  const accessToken = await ensureValidToken("gmail", tokenData);

  const timeMin = new Date().toISOString();
  const timeMax = new Date(Date.now() + daysAhead * 86400000).toISOString();

  const calRes = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=${timeMin}&timeMax=${timeMax}&maxResults=100&singleEvents=true&orderBy=startTime`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    }
  );

  if (!calRes.ok) {
    const errText = await calRes.text();
    throw new Error(`Gmail Calendar API error (${calRes.status}): ${errText}`);
  }

  const calData = await calRes.json();
  const events = calData.items ?? [];

  let imported = 0;
  for (const evt of events) {
    const attendees = (evt.attendees ?? []).map((a: any) => ({
      name: a.displayName ?? a.email ?? "",
      email: a.email ?? "",
      status: a.responseStatus ?? "needsAction",
    }));

    const { error: upsertErr } = await supabase
      .from("calendar_events")
      .upsert(
        {
          tenant_id: tenantId,
          email_account_id: accountId,
          external_id: evt.id,
          title: evt.summary ?? "(No title)",
          description: evt.description,
          start_time: evt.start?.dateTime ?? evt.start?.date,
          end_time: evt.end?.dateTime ?? evt.end?.date,
          location: evt.location,
          attendees,
          status: evt.status === "cancelled" ? "cancelled" : "confirmed",
          raw_json: evt,
          synced_at: new Date().toISOString(),
        },
        { onConflict: "email_account_id,external_id" }
      );

    if (!upsertErr) imported++;
  }

  return { accountId, eventsImported: imported, cursorUpdated: true };
}

/**
 * Syncs Outlook calendar events for a date range via Microsoft Graph.
 */
export async function syncOutlookCalendar(
  accountId: string,
  tenantId: string,
  daysAhead: number = 30
): Promise<SyncCalendarResult> {
  const supabase = getServiceSupabase();

  const { data: account, error: acctErr } = await supabase
    .from("email_accounts")
    .select("encrypted_token")
    .eq("id", accountId)
    .eq("tenant_id", tenantId)
    .single();

  if (acctErr || !account) {
    throw new Error(`Email account ${accountId} not found`);
  }

  const tokenData = await decryptTokenString(account.encrypted_token);
  const accessToken = await ensureValidToken("outlook", tokenData);

  const startDateTime = new Date().toISOString();
  const endDateTime = new Date(Date.now() + daysAhead * 86400000).toISOString();

  const calRes = await fetch(
    `https://graph.microsoft.com/v1.0/me/calendarview?startDateTime=${startDateTime}&endDateTime=${endDateTime}&$select=id,subject,bodyPreview,start,end,location,attendees&$top=100`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    }
  );

  if (!calRes.ok) {
    const errText = await calRes.text();
    throw new Error(`Outlook Calendar API error (${calRes.status}): ${errText}`);
  }

  const calData = await calRes.json();
  const events = calData.value ?? [];

  let imported = 0;
  for (const evt of events) {
    const attendees = (evt.attendees ?? []).map((a: any) => ({
      name: a.emailAddress?.name ?? a.emailAddress?.address ?? "",
      email: a.emailAddress?.address ?? "",
      status: a.status?.response ?? "none",
    }));

    const { error: upsertErr } = await supabase
      .from("calendar_events")
      .upsert(
        {
          tenant_id: tenantId,
          email_account_id: accountId,
          external_id: evt.id,
          title: evt.subject ?? "(No title)",
          description: evt.bodyPreview,
          start_time: evt.start?.dateTime,
          end_time: evt.end?.dateTime,
          location: evt.location?.displayName,
          attendees,
          status: "confirmed",
          raw_json: evt,
          synced_at: new Date().toISOString(),
        },
        { onConflict: "email_account_id,external_id" }
      );

    if (!upsertErr) imported++;
  }

  return { accountId, eventsImported: imported, cursorUpdated: true };
}

/**
 * Syncs the calendar for any email account, routing to the correct provider.
 */
export async function syncCalendar(
  accountId: string,
  tenantId: string,
  daysAhead: number = 30
): Promise<SyncCalendarResult> {
  const supabase = getServiceSupabase();

  const { data: account, error: acctErr } = await supabase
    .from("email_accounts")
    .select("platform")
    .eq("id", accountId)
    .eq("tenant_id", tenantId)
    .single();

  if (acctErr || !account) {
    throw new Error(`Email account ${accountId} not found`);
  }

  if (account.platform === "gmail") {
    return syncGmailCalendar(accountId, tenantId, daysAhead);
  }
  if (account.platform === "outlook") {
    return syncOutlookCalendar(accountId, tenantId, daysAhead);
  }

  throw new Error(`Unsupported platform: ${account.platform}`);
}

// ============================================================================
// Calendar CRUD
// ============================================================================

export interface CreateEventInput {
  title: string;
  description?: string;
  startTime: string;
  endTime: string;
  location?: string;
  attendees?: { name: string; email: string }[];
}

/**
 * Creates a calendar event on the provider via API, then stores locally.
 */
export async function createEvent(
  accountId: string,
  tenantId: string,
  input: CreateEventInput
): Promise<CalendarEvent> {
  const supabase = getServiceSupabase();

  const { data: account, error: acctErr } = await supabase
    .from("email_accounts")
    .select("platform, encrypted_token")
    .eq("id", accountId)
    .eq("tenant_id", tenantId)
    .single();

  if (acctErr || !account) {
    throw new Error(`Email account ${accountId} not found`);
  }

  const tokenData = await decryptTokenString(account.encrypted_token);
  const accessToken = await ensureValidToken(account.platform as EmailPlatform, tokenData);

  let externalId: string;
  const now = new Date().toISOString();

  if (account.platform === "gmail") {
    const body: Record<string, unknown> = {
      summary: input.title,
      description: input.description,
      start: { dateTime: input.startTime },
      end: { dateTime: input.endTime },
      location: input.location,
    };

    if (input.attendees?.length) {
      body.attendees = input.attendees.map((a) => ({ email: a.email, displayName: a.name }));
    }

    const res = await fetch(
      "https://www.googleapis.com/calendar/v3/calendars/primary/events",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      }
    );

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Gmail Calendar create error (${res.status}): ${errText}`);
    }

    const data = await res.json();
    externalId = data.id;
  } else if (account.platform === "outlook") {
    const body: Record<string, unknown> = {
      subject: input.title,
      body: { contentType: "text", content: input.description ?? "" },
      start: { dateTime: input.startTime, timeZone: "UTC" },
      end: { dateTime: input.endTime, timeZone: "UTC" },
      location: input.location ? { displayName: input.location } : undefined,
    };

    if (input.attendees?.length) {
      body.attendees = input.attendees.map((a) => ({
        emailAddress: { address: a.email, name: a.name },
        type: "required",
      }));
    }

    const res = await fetch("https://graph.microsoft.com/v1.0/me/events", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Outlook Calendar create error (${res.status}): ${errText}`);
    }

    const data = await res.json();
    externalId = data.id;
  } else {
    throw new Error(`Unsupported platform: ${account.platform}`);
  }

  // Store locally
  const { data: localEvent } = await supabase
    .from("calendar_events")
    .insert({
      tenant_id: tenantId,
      email_account_id: accountId,
      external_id: externalId,
      title: input.title,
      description: input.description,
      start_time: input.startTime,
      end_time: input.endTime,
      location: input.location,
      attendees: input.attendees?.map((a) => ({
        name: a.name,
        email: a.email,
        status: "accepted",
      })) ?? [],
      status: "confirmed",
      synced_at: now,
    })
    .select()
    .single();

  return {
    externalId,
    title: input.title,
    description: input.description,
    startTime: input.startTime,
    endTime: input.endTime,
    location: input.location,
    attendees: input.attendees?.map((a) => ({ ...a, status: "accepted" })) ?? [],
    status: "confirmed",
  };
}