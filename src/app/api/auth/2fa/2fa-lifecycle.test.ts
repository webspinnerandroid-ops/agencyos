/**
 * Integration test for the 2FA lifecycle — drives the REAL route handlers
 * (setup / verify / status / disable) end to end. Only the auth layer
 * (getUserId/getUserEmail) and the database (createServiceClient) are
 * mocked; the TOTP math and the encryption-at-rest round trip are the real
 * implementations, so the test proves the routes actually wire them
 * together — the same flow a user performs with an authenticator app.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { getUserId, getUserEmail } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { totpAt, generateSecret } from "@/lib/totp";
import { POST as setupPOST } from "./setup/route";
import { POST as verifyPOST } from "./verify/route";
import { GET as statusGET } from "./status/route";
import { POST as disablePOST } from "./disable/route";

// In-memory "user_2fa" table shared by the fake service client.
const { store, makeClient } = vi.hoisted(() => {
  const store = new Map<string, any>();
  class FakeChain {
    constructor(private rows: Map<string, any>) {}
    select(_cols: string) {
      return {
        eq: (col: string, val: any) => ({
          maybeSingle: async () => {
            for (const r of this.rows.values()) {
              if (r[col] === val) return { data: r };
            }
            return { data: null };
          },
        }),
      };
    }
    insert(row: any) {
      // Mirrors the real table: enrolled_at TIMESTAMPTZ NOT NULL DEFAULT now()
      const stored = { enrolled_at: new Date().toISOString(), ...row };
      this.rows.set(stored.user_id, { ...stored });
      return Promise.resolve({ error: null });
    }
    update(patch: any) {
      return {
        eq: async (col: string, val: any) => {
          for (const [k, r] of this.rows) {
            if (r[col] === val) {
              this.rows.set(k, { ...r, ...patch });
              break;
            }
          }
          return { error: null };
        },
      };
    }
    delete() {
      return {
        eq: async (col: string, val: any) => {
          for (const [k, r] of this.rows) {
            if (r[col] === val) {
              this.rows.delete(k);
              break;
            }
          }
          return { error: null };
        },
      };
    }
  }
  return {
    store,
    makeClient: () => ({ from: (t: string) => new FakeChain(store) }),
  };
});

vi.mock("@/lib/auth", () => ({
  getUserId: vi.fn(),
  getUserEmail: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createServiceClient: vi.fn(async () => makeClient()),
}));

const USER_ID = "11111111-1111-4111-8111-111111111111";
const EMAIL = "totp-lifecycle@test.agencyos.app";

const jsonReq = (body: object) =>
  new NextRequest("http://localhost/api/auth/2fa/verify", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });

const currentCode = (secret: string) =>
  totpAt(secret, Math.floor(Date.now() / 30_000));

const json = async (res: Response) => await res.json();

describe("2FA lifecycle (integration)", () => {
  beforeEach(() => {
    store.clear();
    vi.mocked(getUserId).mockResolvedValue(USER_ID);
    vi.mocked(getUserEmail).mockResolvedValue(EMAIL);
    process.env.ENCRYPTION_KEY =
      "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
  });

  it("rejects all endpoints with 401 when unauthenticated", async () => {
    vi.mocked(getUserId).mockResolvedValue(null);

    expect((await statusGET()).status).toBe(401);
    expect((await setupPOST()).status).toBe(401);
    expect((await verifyPOST(jsonReq({ code: "123456" }))).status).toBe(401);
    expect((await disablePOST(jsonReq({ code: "123456" }))).status).toBe(401);
  });

  it("reports not enrolled before setup", async () => {
    const res = await statusGET();
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({ enrolled: false, enrolledAt: null });
  });

  it("setup returns a secret and an otpauth URI labelled with the user email", async () => {
    const res = await setupPOST();
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(body.otpauthUri).toMatch(/^otpauth:\/\/totp\//);
    expect(body.otpauthUri).toContain(`secret=${body.secret}`);
    expect(body.otpauthUri).toContain(encodeURIComponent(EMAIL));
  });

  it("enrolls with a valid authenticator code and stores the secret encrypted", async () => {
    const { secret } = await json(await setupPOST());

    const res = await verifyPOST(jsonReq({ code: currentCode(secret), secret }));
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({ ok: true, enrolled: true });

    // Stored at rest encrypted — plaintext secret must never hit the DB.
    const stored = [...store.values()][0];
    expect(stored.secret_encrypted).toBeTruthy();
    expect(stored.secret_encrypted).not.toBe(secret);

    const status = await json(await statusGET());
    expect(status.enrolled).toBe(true);
    expect(status.enrolledAt).toBeTruthy();
  });

  it("rejects a wrong code during enrollment and leaves the account unenrolled", async () => {
    const { secret } = await json(await setupPOST());
    const res = await verifyPOST(jsonReq({ code: "000000", secret }));
    expect(res.status).toBe(400);
    expect(store.size).toBe(0);
  });

  it("rejects a second enrollment attempt with 409", async () => {
    const { secret } = await json(await setupPOST());
    await verifyPOST(jsonReq({ code: currentCode(secret), secret }));

    // setup again → already enabled
    expect((await setupPOST()).status).toBe(409);
    // verify with a fresh pending secret → already enabled
    const freshSecret = generateSecret();
    const second = await verifyPOST(
      jsonReq({ code: currentCode(freshSecret), secret: freshSecret })
    );
    expect(second.status).toBe(409);
  });

  it("login challenge verifies a code against the stored secret (no secret sent)", async () => {
    const { secret } = await json(await setupPOST());
    await verifyPOST(jsonReq({ code: currentCode(secret), secret }));

    const res = await verifyPOST(jsonReq({ code: currentCode(secret) }));
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({ ok: true, verified: true });

    // last_verified_at stamped on success
    const stored = [...store.values()][0];
    expect(stored.last_verified_at).toBeTruthy();
  });

  it("login challenge accepts codes from the adjacent 30s window", async () => {
    const { secret } = await json(await setupPOST());
    await verifyPOST(jsonReq({ code: currentCode(secret), secret }));

    const step = Math.floor(Date.now() / 30_000);
    const prevStepCode = totpAt(secret, step - 1);
    const res = await verifyPOST(jsonReq({ code: prevStepCode }));
    expect(res.status).toBe(200);
    expect((await json(res)).verified).toBe(true);
  });

  it("login challenge rejects a wrong code with 400", async () => {
    const { secret } = await json(await setupPOST());
    await verifyPOST(jsonReq({ code: currentCode(secret), secret }));

    const res = await verifyPOST(jsonReq({ code: "000000" }));
    expect(res.status).toBe(400);
    expect((await json(res)).error).toMatch(/Invalid code/);
  });

  it("login challenge without a stored record returns 400", async () => {
    const res = await verifyPOST(jsonReq({ code: "123456" }));
    expect(res.status).toBe(400);
    expect((await json(res)).error).toMatch(/not enabled/);
  });

  it("rejects a malformed code with 400", async () => {
    const res = await verifyPOST(jsonReq({ code: "12" }));
    expect(res.status).toBe(400);
  });

  it("disable requires a valid current code, then removes enrollment", async () => {
    const { secret } = await json(await setupPOST());
    await verifyPOST(jsonReq({ code: currentCode(secret), secret }));

    // Wrong code → rejected, still enrolled.
    const wrong = await disablePOST(jsonReq({ code: "000000" }));
    expect(wrong.status).toBe(400);
    expect((await json(await statusGET())).enrolled).toBe(true);

    // Valid code → disabled.
    const ok = await disablePOST(jsonReq({ code: currentCode(secret) }));
    expect(ok.status).toBe(200);
    expect(await json(ok)).toEqual({ ok: true, disabled: true });
    expect(store.size).toBe(0);
    expect((await json(await statusGET())).enrolled).toBe(false);
  });

  it("supports re-enrollment after disabling", async () => {
    const { secret } = await json(await setupPOST());
    await verifyPOST(jsonReq({ code: currentCode(secret), secret }));
    await disablePOST(jsonReq({ code: currentCode(secret) }));

    const res = await setupPOST();
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.secret).toMatch(/^[A-Z2-7]{32}$/);
  });

  it("disable without a stored record returns 400", async () => {
    const res = await disablePOST(jsonReq({ code: "123456" }));
    expect(res.status).toBe(400);
    expect((await json(res)).error).toMatch(/not enabled/);
  });
});
