# End‑to‑End Test Plan

This document outlines the manual E2E verification steps for the Agency OS platform. Follow these instructions after setting up your local environment to confirm every user journey works as expected.

---

## Prerequisites

- [ ] Local dev server running (`npm run dev`)
- [ ] Supabase instance (local or cloud) with all migrations applied
- [ ] At least one AI provider key configured via `/dashboard/settings/ai` (or set in `.env.local` as fallback)
- [ ] Stripe test mode keys configured (or accept that billing routes return mock data when keys are absent)

---

## 1. Sign Up as Agency

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1.1  | Navigate to `/login` | Login page renders with Email/Password form |
| 1.2  | Click "Sign Up" or equivalent | Registration form appears |
| 1.3  | Enter agency email + password, submit | Redirect to `/dashboard` (or `/pending-approval` if auth schema requires) |
| 1.4  | Check Supabase `auth.users` table | New user record exists |
| 1.5  | Check `user_roles` table | Row with `tenant_id` and `role = 'agency_admin'` exists |

**Result: ✅ / ❌**

---

## 2. Add Client

| Step | Action | Expected Result |
|------|--------|-----------------|
| 2.1  | Go to any dashboard page that loads clients (Analytics, Calendar, Generate) | Client dropdown is present |
| 2.2  | POST to `/api/clients` with `{ name, email?, website? }` | 201, client created under your tenant |
| 2.3  | Verify in Supabase `clients` table | New row with your `tenant_id` |
| 2.4  | Confirm client appears in dropdowns across dashboard | Client is selectable |

**Result: ✅ / ❌**

---

## 3. Generate SEO Campaign

| Step | Action | Expected Result |
|------|--------|-----------------|
| 3.1  | Navigate to `/dashboard/seo/campaigns` | Campaign generator page renders |
| 3.2  | Enter Client ID + Website URL (e.g. `https://example.com`) | Inputs accept values |
| 3.3  | Click **Generate Campaigns** | Loading indicator, then **Site Audit Summary** card appears with score + issues |
| 3.4  | Scroll to **Generated Campaign Tiers** | 3-4 pricing-tier cards (Foundation/Growth/Dominance + optional Enterprise) |
| 3.5  | Click **Customize** on an Enterprise tier | JSON editor modal opens |
| 3.6  | Modify the JSON, click **Save Customization** | Modal closes, tier card updates |
| 3.7  | Click **Present to Client** | Green banner with proposal link appears |
| 3.8  | Verify in Supabase `seo_campaigns` table | Campaign rows with `client_id`, `campaign_json`, `tier_name` |

**Result: ✅ / ❌**

---

## 4. Approve Tier (Client Portal)

| Step | Action | Expected Result |
|------|--------|-----------------|
| 4.1  | Open a second browser session (incognito) as a client user | — |
| 4.2  | Log in as client user (must have `client_id` in `user_roles`) | Redirected to `/(client-portal)/dashboard` |
| 4.3  | Portal header shows agency brand (or fallback "Client Portal") | White‑labelled header renders |
| 4.4  | Posts assigned to that client are listed | Cards with status badges rendered |
| 4.5  | Click **Approve** on a post | Post status updates to "approved" |
| 4.6  | Verify in Supabase `posts` table | `status = 'approved'` for that post |

**Result: ✅ / ❌**

---

## 5. Create Posts (Content Generation)

| Step | Action | Expected Result |
|------|--------|-----------------|
| 5.1  | As agency, navigate to `/dashboard/generate` | Generate form renders |
| 5.2  | Enter a topic (e.g., "Best social media strategies for 2026") | Input accepts text |
| 5.3  | Select platforms (Instagram, LinkedIn, Twitter/X) | Checkboxes toggle |
| 5.4  | Optionally select a client from dropdown | Client selected |
| 5.5  | Click **Generate Content** | Loader, then blog post preview + social captions appear |
| 5.6  | Click **Copy Body** on the blog post card | Text copied to clipboard |
| 5.7  | Review social captions per platform | Captions, hashtags, first-comment visible |
| 5.8  | (Optional) POST generated content to `/api/posts` via calendar scheduling | Post appears in Calendar |

**Result: ✅ / ❌**

---

## 6. Schedule & Publish (Mock)

| Step | Action | Expected Result |
|------|--------|-----------------|
| 6.1  | Navigate to `/dashboard/calendar` | Calendar view with month grid renders |
| 6.2  | Drag a post to a new date | `PATCH /api/posts/:id` fires, post moves to new date |
| 6.3  | Click a post in the calendar | Detail modal/sidebar opens showing content + status |
| 6.4  | Change status from "draft" to "scheduled" | Status updates in calendar |
| 6.5  | Mock publish: set status to "published" | Post appears in Analytics table after refresh |

**Result: ✅ / ❌**

---

## 7. View Analytics

| Step | Action | Expected Result |
|------|--------|-----------------|
| 7.1  | Navigate to `/dashboard/analytics` | Analytics page renders with filters |
| 7.2  | Select a client (if available) | Client‑specific data loads |
| 7.3  | Adjust date range | Data refreshes for that range |
| 7.4  | Verify Summary Cards | Total Posts, Engagement Rate, Likes, Impressions, Comments, Shares all show values |
| 7.5  | Verify Line Chart | Likes/Comments trend over time renders |
| 7.6  | Verify Post Performance Table | Individual posts with metrics |
| 7.7  | Click **Export Report** | PDF downloads with filename `analytics-report-YYYY-MM-DD.pdf` |

**Result: ✅ / ❌**

---

## 8. Manage Billing

| Step | Action | Expected Result |
|------|--------|-----------------|
| 8.1  | Navigate to `/dashboard/billing` | Billing page renders |
| 8.2  | If no subscription: plan cards (Foundation / Growth / Dominance) are displayed | Subscribe buttons visible |
| 8.3  | Click **Subscribe to Growth ($99/mo)** | Stripe checkout redirect (or mock message if keys absent) |
| 8.4  | After checkout: verify success redirect to `/dashboard/billing?success=true` | Green success banner appears |
| 8.5  | Verify **Usage (Current Month)** section | Usage cards with progress bars for AI Tokens, Social Profiles, Blog Posts, Social Posts |
| 8.6  | Verify **Billing History** table | Invoices listed (may be empty on fresh account) |

**Result: ✅ / ❌**

---

## 9. White‑Label Branding

| Step | Action | Expected Result |
|------|--------|-----------------|
| 9.1  | Navigate to `/dashboard/settings/white-label` | Settings page renders |
| 9.2  | Upload a logo (PNG/SVG) | Logo preview appears |
| 9.3  | Change brand colour using colour picker or presets | Swatch updates |
| 9.4  | Click **Save Colour** | Success toast |
| 9.5  | Enter a custom domain (e.g. `portal.myagency.com`) | Input accepts value |
| 9.6  | Click **Save Domain** | Success toast |
| 9.7  | Reload the client portal in incognito | Brand colour + logo applied to header |

**Result: ✅ / ❌**

---

## 10. AI Settings

| Step | Action | Expected Result |
|------|--------|-----------------|
| 10.1 | Navigate to `/dashboard/settings/ai` | AI settings page renders |
| 10.2 | Select a provider (e.g. OpenAI) | Dropdown populates |
| 10.3 | Enter API key, toggle visibility icon | Key masked/unmasked |
| 10.4 | Click **Add Key** | Key appears in "Your API Keys" list with Active badge |
| 10.5 | Toggle the key off → on | Status badge updates |
| 10.6 | Map a task to a model (e.g. Blog → GPT-4o) | Select changes, success toast |
| 10.7 | Delete a key | Confirmation prompt, key removed |

**Result: ✅ / ❌**

---

## 11. Error & Loading States

| Step | Action | Expected Result |
|------|--------|-----------------|
| 11.1 | Navigate between pages rapidly | React Suspense loading spinners appear (`loading.tsx`) |
| 11.2 | Disconnect network → navigate to `/dashboard/billing` | Error boundary renders with "Try Again" button |
| 11.3 | Click **Try Again** after reconnecting | Page reloads successfully |
| 11.4 | Monitor browser console during errors | No uncaught `window.onerror` — errors are caught by boundaries |

**Result: ✅ / ❌**

---

## Final Checklist

| # | Journey | Status |
|---|---------|--------|
| 1 | Sign up as agency | ⬜ |
| 2 | Add client | ⬜ |
| 3 | Generate SEO campaign | ⬜ |
| 4 | Approve tier (client portal) | ⬜ |
| 5 | Create posts (AI generation) | ⬜ |
| 6 | Schedule & publish (mock) | ⬜ |
| 7 | View analytics | ⬜ |
| 8 | Manage billing | ⬜ |
| 9 | White‑label branding | ⬜ |
| 10 | AI settings | ⬜ |
| 11 | Error & loading states | ⬜ |