# Make.com recipe — Facebook Pages + Instagram via the relay

Module-by-module clicks for the scenario that receives your app's relay
payload and publishes to a Facebook Page and an Instagram account. Grade-5
level: every click is written out.

**The key fact that keeps this simple:** your app's publish scheduler
already waits for the right moment — when your webhook rings, the post is
due *now*. So the scenario just publishes immediately. You do not need
Make's scheduler or Sleep modules. (The `scheduledAt` field in the payload
is informational.)

The payload your app POSTs to the webhook (JSON):

```json
{
  "platform": "facebook",          // or "instagram", "linkedin", ...
  "caption": "The post text",
  "mediaUrls": ["https://…/photo.jpg"],
  "scheduledAt": "2026-09-20T10:00:00.000Z",
  "postPlatformId": "uuid-of-post-platform",
  "tenantId": "uuid-of-tenant"
}
```

---

## What you need

1. A make.com account (the free plan is enough to start).
2. The login (email + password) for the Facebook account that administers
   the client's Facebook Page.
3. The client's Instagram account must be a **Business or Creator**
   account **linked to that Facebook Page** (free setting inside the
   Instagram app: Settings → Business tools). Meta requires this for ANY
   API posting — Make included.
4. Ten minutes.

---

## Part A — the webhook trigger

1. Log in to make.com → click **Create a new scenario** (top-right).
2. Click the big **+** in the middle of the canvas.
3. In the app picker, search **Webhooks** → choose **Webhooks** → click
   **Custom webhook**.
4. Click **Create a webhook**, name it `agency-os relay`, click **Save**.
5. Make shows a URL like `https://hook.eu1.make.com/abc123…`.
   **Copy it.**
6. In your app: **Settings → Social → Publish via Make.com** → paste the
   URL → **Save URL** → click **Send test post**.
7. Back in Make, the webhook module now shows it determined the data
   structure. (If it doesn't auto-detect, that's fine — the mappings in
   Part B use the field names directly.)

> Leave the scenario editor open. Every module below is added to the right
> of this webhook.

## Part B — the Router (one branch per platform)

1. Click the **wrench/tool icon** on the line *after* the webhook →
   **Add a module** → search **Router** → click **Router**.
2. Make draws two branches. You'll point each branch at one platform.

### Facebook branch

3. On the first branch, click **Add a module** → search **Facebook Pages**
   → click **Create a Post**.
4. **Connection** → **Add** → a Facebook popup opens → log in with the
   account that administers the Page → click **Allow/OK** on every
   permission screen. (This is Make's pre-approved app asking — you never
   touch Meta's developer review.)
5. Back in the module, pick the **Page** from the dropdown.
6. Set the fields exactly like this (type the values, don't paste):
   - **Page**: select the client's Page
   - **Message**: click the field, then from the mapping panel choose
     **caption** (under the webhook's fields)
   - **Link**: leave empty
   - **Photo / media**: see "Images" below
7. **Filter** (so Facebook only gets Facebook posts): click the **wrench
   on the branch line** between Router and the module → **Set up a
   filter** → Label `facebook only` → Condition:
   - Field 1: choose **`platform`** from the webhook
   - Operator: **Equal to**
   - Field 2: type `facebook`
   → OK.

### Instagram branch

8. On the second branch: **Add a module** → search **Instagram for
   Business** → click **Create a Post**.
9. **Connection** → **Add** → log in with the Instagram-linked Facebook
   account → **Allow**.
10. Fields:
    - **Account**: select the client's Instagram business account
    - **Caption**: map **`caption`**
    - **Photo URL**: map **`mediaUrls[]`** — click the field, then in the
      mapping panel expand `mediaUrls` and drag the **first-item**
      element (or use `{{first(map(1.mediaUrls; null))}}` in the
      formula editor for robustness). Instagram requires exactly one
      image per basic post; your app always sends at least one image URL
      for social posts.
11. **Filter** on this branch: same as Facebook but Field 2 is
    `instagram`, **plus** a second condition so empty-image posts don't
    error: click **Add and rule** → Field: `mediaUrls` → Operator:
    **Greater than** → Value: `0`... (Make tests array length when the
    field is an array — if your Make version won't accept the array here,
    use the text operator "Greater than" on
    `{{length(1.mediaUrls)}}` instead.)

### More platforms later

For LinkedIn, TikTok, Threads, Reddit, Pinterest: add another branch per
platform, same pattern — platform module, log in once, map `caption`
(+ media where the platform supports it), filter on `platform` equal to
that name.

## Part C — images (both platforms)

- The app sends **hosted public URLs** in `mediaUrls` — no uploads needed.
- Facebook "Create a Post": use the module's **Photo URL / Photos** field
  and map `mediaUrls` (Make accepts multiple; it posts an album).
- Instagram: first URL only (IG limitation, one image per post).

## Part D — turn it on and test

1. Bottom-left of the scenario editor: toggle **Scheduling ON**
   (choose "Immediately" / 15-min intervals — webhook scenarios run on
   arrival regardless; the toggle just enables the scenario).
2. Click the **Run once** button once so the scenario is armed.
3. In your app, publish a real draft (Posts page → Publish) or press
   **Send test post** in Settings → Social.
4. Watch Make: the scenario bubble lights up; click it to see every
   module's input/output.
5. In your app: the attempt now shows in the **publishing history** as
   `facebook → via Make.com` with ✓ or ✕ and any error Make returned.

---

## Multiple clients from one system

Every payload carries `tenantId` and `postPlatformId`. If you publish for
several clients from the same system, either:

- **One scenario, one branch per client-account**: duplicate the Facebook
  branch, connect the *other* client's account, and filter on the
  additional field you'll add per client (ask me to add `clientId` /
  `clientName` to the payload — small change, then filter on it); or
- **One scenario per client**: create a second webhook + scenario, and
  paste that client's webhook URL into that client's system. Cleanest
  separation — you can even hand a VA just their scenario's history.

## Troubleshooting

| Symptom | Meaning / fix |
|---|---|
| App shows ✕ `Make webhook returned 4xx` | Scenario OFF, webhook deleted, or filter rejected everything. Check the scenario history in Make. |
| IG module errors "media url required" | The post had no image and the length filter is missing — re-add the Part B step 11 rule. |
| Nothing arrives at Make | The stored relay URL may be paused: Settings → Social shows **Last test … — failed**. Re-save the URL. |
| Wrong Page/account posted | Two branches share one connection — each branch needs its own Connection with that client's login. |
| Facebook says "document requires higher access" | The Page's admin removed the app's permissions: re-run **Connection → Re-authorize**. |
