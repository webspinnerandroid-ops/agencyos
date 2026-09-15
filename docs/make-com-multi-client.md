# Make.com — One Scenario for All Your Clients (Step-by-Step)

This guide explains how to set up **one Make.com scenario** that posts to the
right client's accounts automatically. No code, no app reviews — just clicks.

**How it works in one sentence:** our app sends every post to your webhook
with a `clientId` label on it, and your Make scenario reads that label and
sends the post to that client's Facebook/Instagram/LinkedIn/etc. account.

---

## What you need before starting

1. A Make.com account (the free plan is fine to start).
2. The username and password for each client's social account
   (or ask the client to log in themselves during the "Allow" step).
3. About 30 minutes.

---

## Part 1 — Start a new scenario

1. Go to **make.com** and sign in.
2. Click the big **"Create a new scenario"** button (top right).
3. You'll see an empty canvas with a big **"+"** in the middle. That's where
   your first module goes.

## Part 2 — The trigger (where posts arrive)

1. Click the **"+"** and search for **"Webhooks"**.
2. Choose **"Custom webhook"**.
3. Click **"Create a webhook"**, give it a name like `agencyos-posts`, and
   click **Save**.
4. Make shows you a URL that looks like
   `https://hook.eu2.make.com/abc123xyz…` — **copy it**.
5. Click **OK**.

✅ Checkpoint: paste that URL into our app under
**Settings → Social → Publish via Make.com → Save URL**, then click
**Send test post**. Make will show "Determining data structure" — run the
test once and Make learns the fields.

## Part 3 — Teach Make the fields (run the test once)

1. In our app, click **Send test post** (Settings → Social).
2. Back in Make, click the webhook module and then **"Run once"** isn't
   needed — Make captured the sample automatically. You should now see
   fields like `platform`, `caption`, `clientId`, `clientName`,
   `mediaUrls`, `scheduledAt` when you click inside later modules.

## Part 4 — The Router (the sorting hat)

1. Click the **wrench/plus** after the webhook and add **"Flow control →
   Router"**. A router splits one incoming post into different paths.
2. Click the **first route** (the wrench on the route line) → **Set up a
   filter**:
   - Label: `Decore Hotels — Facebook`
   - Condition: `platform` … **Equal to** … `facebook`
     **and** `clientId` … **Equal to** … `decore-hotels` *(that client's
     actual id — see Part 6 for where to find it)*
3. Click **"Add route"** for each client/platform mix you need and give
   each route its own two conditions (platform + clientId).

## Part 5 — The Facebook module (repeat per client)

1. On the route you just filtered, click **"+"** → search **"Facebook
   Pages"** → choose **"Create a Post"**.
2. Click **"Add"** next to Connection → log in with **that client's**
   Facebook account → **Allow**. (Each client's login lives only here, in
   its own connection.)
3. Fill in:
   - **Page**: pick the client's page from the dropdown.
   - **Message**: click the field and map `caption` from the webhook.
   - **Photo/video URL** (if you post images): map the first item of
     `mediaUrls`.
4. Click **OK**.

## Part 6 — Where do I find a client's `clientId`?

Two easy places:

- In our app: **Clients** page → open the client → the id is in the URL
  bar (`/dashboard/clients/<this-part-is-the-id>`).
- Or in Make itself: run one **Send test post** with the
  `clientId`/`clientName` fields visible in the webhook output — the test
  shows real values. `clientName` (like `Decore Hotels`) is sent alongside
  the id, so you can also filter on `clientName` if that's easier to read.

## Part 7 — Optional: hold posts until their scheduled time

Our app sends `scheduledAt` (the date/time the post should go out). If you
want Make to wait:

1. Add **"Tools → Sleep"** before the Facebook/Instagram module.
2. You can't map `scheduledAt` directly into Sleep's fixed number, so the
   simplest reliable approach: leave Sleep out and let our app's scheduler
   decide WHEN to call the webhook (it only fires at publish time), OR
3. Use Make's built-in **scheduler**: set the scenario to run
   **"On demand"** is wrong here — instead leave the trigger as the webhook
   (posts run immediately when our app sends them, which is already at the
   scheduled time).

👉 In short: **you don't need Sleep.** Our app only calls the webhook when
the post is due.

## Part 8 — Turn it on

1. Click the **scheduling toggle** (bottom left) → **ON**.
2. Send a test post from our app again and watch it appear in **History**
   (left sidebar) with the right route lighting up.

---

## Per-client scenarios (the other way)

Prefer one scenario per client? Even simpler:

1. Create a scenario per client with **no Router** — just webhook →
   Facebook/Instagram modules connected to that client's accounts.
2. In our app: **Settings → Social → Per-client webhooks** → paste that
   scenario's webhook URL under the matching client → Save.
3. Posts for that client now go to their own scenario automatically;
   clients without their own URL keep using the tenant-wide one.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| Nothing arrives in Make | Check the webhook URL was pasted with no spaces; click **Send test post** again. |
| Route never fires | Filter conditions must BOTH match — check the `clientId` spelling (it's a UUID-like string, copy-paste it). |
| Post arrives without an image | The row had no image; that's normal. Images arrive as URLs in `mediaUrls`. |
| "Last test — failed" in our app | Make returned an error: open Make → History → the red run shows the module that complained (usually a disconnected login — re-click Allow). |
