# Runbook — Enable Google Business Profile APIs & Publish OAuth Consent Screen

Use this runbook for **any new Google Cloud project** that needs Business Profile access (e.g. project `719341124652`). Repeat for each project / client account.

---

## 0. Context (why this runbook exists)

- The app connects Google accounts via OAuth (`business.manage` scope) and calls:
  - **My Business Account Management API** — `mybusinessaccountmanagement.googleapis.com/v1/accounts`
  - **My Business Business Information API** — `mybusinessbusinessinformation.googleapis.com/v1/.../locations?readMask=...`
  - **My Business API (legacy v4)** — `mybusiness.googleapis.com/v4/.../reviews`
- Google must **approve** the project for the Business Profile API (allowlist request). Approval grants **300 QPM** by default.
- The app already retries 429/5xx automatically (≈1s then ≈3s backoff + jitter), so a 429 error surfacing in the UI means the quota is genuinely exhausted, not a transient blip.

## 1. Enable the APIs

1. Open <https://console.cloud.google.com/> and select the project (use the project number, e.g. `719341124652`).
2. **APIs & Services → Library**, search for and **Enable** each of:
   - **My Business Account Management API**
   - **My Business Business Information API**
   - **Google My Business API** (legacy v4 — needed for reviews)
3. Verify under **APIs & Services → Enabled APIs** that all three appear.

> ⚠️ If an API shows a "request access" / allowlist prompt instead of Enable, the project's allowlist approval (from Google) hasn't landed on this project yet — check which project number the approval email refers to before proceeding.

## 2. Publish the OAuth consent screen

1. **APIs & Services → OAuth consent screen** (or **Google Auth Platform → Branding/Audience** in newer UI).
2. User type: **External** (or Internal if you're Workspace and prefer that).
3. Fill in App name, support email, developer contact. Add the `.../auth/business.manage` scope to the scope list if the UI asks for it.
4. **Audience → Publish app → Confirm** (switch from *Testing* to *In production*).

> ⚠️ While in *Testing*, only listed "test users" can complete the OAuth flow — everyone else gets `access_denied`. Publishing avoids that for all your client accounts. Unverified-sensitive-scope warnings don't block the `business.manage` flow for your own accounts, but review Google's verification guidance if Google requests it.

## 3. OAuth credentials

1. **APIs & Services → Credentials → Create credentials → OAuth client ID**.
2. Type: **Web application**.
3. **Authorized redirect URIs** — add, for each deployment:
   - `https://<your-production-domain>/api/auth/callback/google`
   - `http://localhost:3000/api/auth/callback/google` (dev)
4. Copy the **Client ID** (e.g. `719341124652-xxxx.apps.googleusercontent.com`) and **Client secret** into the deployment env:
   - `GOOGLE_CLIENT_ID=...`
   - `GOOGLE_CLIENT_SECRET=...`
   - Also confirm `NEXT_PUBLIC_SITE_URL` matches the production origin (the OAuth redirect depends on it).

## 4. Verify the setup end-to-end

1. In the app: **Dashboard → Connections → Google Business Profile → Connect Google Account**.
2. Pick businesses via **Choose businesses** (picker lists every location the account manages).
3. **Settings → Google Business Profile → Google Reviews → Load reviews** — reviews should appear for connected listings.
4. If a call 429s persistently: **APIs & Services → Quotas** → check **My Business Account Management API** (and Business Information API) quotas; the project default is 300 QPM.

## 5. Troubleshooting

| Symptom | Likely cause / fix |
|---|---|
| `access_denied` at OAuth consent | Consent screen still in *Testing* and user not a test user → publish the app (§2) or add the user as a test user. |
| `Google account lookup failed: ...` | Account Management API not enabled on this project, or allowlist not approved → §1. |
| Reviews card shows `HTTP 403` per listing | Legacy **Google My Business API (v4)** not enabled, or the account can't manage that listing → §1 and re-run "Choose businesses". |
| 429 after retries | Quota exhausted — check **APIs & Services → Quotas**; project is approved for 300 QPM. |
| Listing "not found on the connected Google accounts" | Listing was deleted/renamed on Google, or ownership moved → re-run **Choose businesses**. |
| New deployment can't connect | `NEXT_PUBLIC_SITE_URL` mismatch or redirect URI not registered → §3. |

---

*Project referenced here: `719341124652`. Repeat per project; nothing in this runbook is project-specific except that number.*
