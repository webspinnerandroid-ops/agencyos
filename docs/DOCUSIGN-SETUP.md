# DocuSign eSignature Setup

The platform sends proposals for e-signature via DocuSign's eSignature REST API
(v2.1, JWT Grant flow). Once configured, the "Send for signature" button on a
proposal creates an envelope, gives the client a one-time signing URL, and the
DocuSign **Connect** webhook marks the proposal signed and auto-starts the
campaign.

Until the variables below are set, the button shows
`DocuSign is not configured for this deployment` and proposals can still be
approved directly (no signature).

---

## 1. Create a DocuSign developer account (free)

1. Go to https://developers.docusign.com/ and click **Sign Up Free**.
2. After confirming your email you land in the **DocuSign Admin** with a
   **sandbox (demo) account**. Sandbox costs nothing and works end-to-end for
   testing — signatures are real, but the account is in the demo environment.

> Production note: when you're ready to go live, you must request a
> **production account** (a paid eSignature plan) from DocuSign support and
> then repeat the app steps below in production. Everything else is identical.

---

## 2. Register an app to get the Integration Key (client ID)

1. In DocuSign Admin, go to **Apps and Keys**
   (`https://admindemo.docusign.com/api-access` for sandbox).
2. Click **Add App and Integration Key** → name it (e.g. `Agency OS`) → **Save**.
3. On the app page you'll see **Integration Key** — that long alphanumeric
   string is your `DOCUSIGN_INTEGRATION_KEY`. Copy it.

### Configure the app for JWT Grant (service integration)

On the same app page:

- **Authentication → JWT Grant**: your sandbox user (the one you signed up
  with) should already be listed as an **Impersonated User**. If not, add your
  user's email. This is required — the app calls the API *as that user*.
- **Service Integration**: set a **Redirect URI** to `https://localhost:3000` —
  this is only used for the consent dance, the app itself never redirects a
  browser there. (Optional but recommended; some DocuSign accounts require it
  before the token exchange works.)
- **Connect** (webhook): click **Connect Configuration** → **Add**:
  - **Connect Configuration Name**: `Agency OS connect`
  - **URL to Publish**: `https://<your-domain>/api/docusign/connect`
    (on the VPS, the full platform URL — e.g. `https://platform.yourdomain.com/api/docusign/connect`)
  - **Enable Log**: recommended for debugging
  - **Trigger Events** (Data Format → Include):
    - `Envelope` → **Envelope Completed** (required)
    - `Envelope` → **Envelope Sent** / **Declined** (optional)
  - Click **Save**, then on the Connect config click **Edit** → copy the
    **Secret Key** DocuSign shows — that's your `DOCUSIGN_CONNECT_SECRET`.

---

## 3. Get your User GUID (impersonated user ID)

1. In DocuSign Admin → **Users** (`https://admindemo.docusign.com/users`),
   find your user (the one listed as Impersonated User on the app).
2. The **User ID / GUID** column is your `DOCUSIGN_USER_ID`.

---

## 4. Generate the RSA keypair

DocuSign requires an RSA keypair; the **private key** stays in your server env,
the **public key** is uploaded to the app.

Generate with OpenSSL (Git Bash, WSL, or any Linux box — not PowerShell):

```bash
openssl genrsa -out docusign_private.pem 2048
openssl rsa -in docusign_private.pem -pubout -out docusign_public.pem
```

> If you're on Windows without OpenSSL handy, any of these work:
> - Git Bash: `openssl` is included.
> - Online generators (e.g. https://cryptotools.net/rsagen) — generate a
>   2048-bit key, download the **private** key and the **public** key.
>   Keep the private key private; never paste it into chat or a public repo.

Upload the **public** key: back on the app page in DocuSign Admin →
**Authentication → JWT Grant → Add public key** → paste the contents of
`docusign_public.pem` → **Save**.

Keep `docusign_private.pem` — it's your `DOCUSIGN_PRIVATE_KEY`.

---

## 5. Grant consent (one-time)

The first token exchange needs the impersonated user's consent. Open this URL
in a browser **while logged in as the impersonated user**:

```
https://account-d.docusign.com/oauth/auth?response_type=code&scope=signature&client_id=<INTEGRATION_KEY>&redirect_uri=https://localhost:3000
```

After approving, you'll get a browser error or a `localhost` connection refused
— that's expected and fine; the consent has been recorded. (Use
`account.docusign.com` instead of `account-d.docusign.com` in production.)

---

## 6. Environment variables

Add all of these to **`.env.local`** (local dev) and the **VPS env**
(`/etc/environment` or whatever your deploy process uses), then restart.

| Variable | Value | Required |
|---|---|---|
| `DOCUSIGN_INTEGRATION_KEY` | Integration Key from step 2 | ✅ |
| `DOCUSIGN_USER_ID` | User GUID from step 3 | ✅ |
| `DOCUSIGN_PRIVATE_KEY` | Full PEM contents of `docusign_private.pem` — with real newlines, or `\n`-escaped in one line | ✅ (or base64 variant) |
| `DOCUSIGN_PRIVATE_KEY_BASE64` | `base64 docusign_private.pem` — alternative to the raw PEM for env files that hate newlines | ✅ (alternative) |
| `DOCUSIGN_CONNECT_SECRET` | Connect Secret Key from step 2 | ✅ for webhook verify |
| `DOCUSIGN_ACCOUNT_ID` | Your account GUID (Admin → **API and Keys** → *Account ID*) | optional — defaults to your primary account |
| `DOCUSIGN_AUTH_SERVER` | `account-d.docusign.com` (sandbox) or `account.docusign.com` (production) | optional — defaults to sandbox |
| `DOCUSIGN_APP_URL` | The platform's public base URL, e.g. `https://platform.yourdomain.com` — used for the post-signing return URL | optional |

### Setting the private key in `.env.local`

Env files can't hold multi-line values cleanly, so the code accepts either:

- **`\n`-escaped single line** — convert the PEM with:
  ```bash
  tr '\n' '\\n' < docusign_private.pem
  ```
  then paste the output as the value.
- **Base64** (cleanest):
  ```bash
  base64 -w0 docusign_private.pem   # macOS/Linux/Git Bash
  ```
  Paste the output as `DOCUSIGN_PRIVATE_KEY_BASE64`.

---

## 7. Verify it works

1. `cd agency-os && npx vitest run src/lib/docusign.test.ts` — unit tests for
   the HMAC verifier and the HTML builder should pass.
2. Open a proposal in the dashboard → **Send for signature**. If the env is
   right, you'll get a signing URL (no more "not configured").
3. Sign as the test client. The Connect webhook
   (`/api/docusign/connect`) marks the proposal signed and auto-starts the
   campaign.
4. Check the signed document archived to the workspace (stored via the
   `signed_document_url` column added in migration 030).

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| `DocuSign is not configured` | One of the three required vars is missing (`INTEGRATION_KEY`, `USER_ID`, private key) — the server was started before the vars were added, or they're on the wrong machine (local vs VPS). |
| `DocuSign token exchange failed (401)` | Consent not yet granted (step 5), public key not uploaded (step 4), or `DOCUSIGN_AUTH_SERVER` doesn't match the account (sandbox vs prod). |
| `No DocuSign account found for this user` | The user GUID is from a different account than the integration key; or `DOCUSIGN_ACCOUNT_ID` points at the wrong account. |
| `anchor ... tabs were not applied` | The signer tab marker wasn't found — the code auto-retries with fixed coordinates, so this is usually harmless. |
| Webhook 401s / `verifyConnectSignature` false | `DOCUSIGN_CONNECT_SECRET` mismatch — copy the **Secret Key** from the Connect config (step 2) exactly, then re-send a test envelope. |
