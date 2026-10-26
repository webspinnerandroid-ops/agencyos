import { NextResponse } from "next/server";
import type { ZodType } from "zod";

/**
 * Request-body validation for route handlers.
 *
 * Most routes still read `await request.json()` and destructure — which accepts
 * any shape, any type, and any size. This helper is the one place that turns a
 * request body into typed data or a consistent 400, so route families can adopt
 * it one at a time (see scripts/audit-validation.cjs for the ratchet).
 *
 * The error shape is deliberately stable for the UI:
 *   { error: "Invalid request body", code: "invalid_body", issues: [{path, message}] }
 */

/** Bodies above this are refused before parsing (JSON bombs, image blobs). */
export const MAX_JSON_BYTES = 256 * 1024;

export interface ValidationIssue {
  path: string;
  message: string;
}

export type ValidateFail = {
  ok: false;
  reason: "empty_body" | "too_large" | "invalid_json" | "invalid_body";
  issues: ValidationIssue[];
};

export type ValidateResult<S extends ZodType> =
  | { ok: true; data: import("zod").infer<S> }
  | ValidateFail;

/**
 * Parse + validate a raw body string. Pure (no Next.js, no I/O) so it can be
 * unit-tested directly.
 */
export function validateJson<S extends ZodType>(
  raw: string,
  schema: S
): ValidateResult<S> {
  if (raw.length > MAX_JSON_BYTES) {
    return {
      ok: false,
      reason: "too_large",
      issues: [{ path: "", message: `Body exceeds ${MAX_JSON_BYTES} bytes` }],
    };
  }
  if (raw.trim().length === 0) {
    return {
      ok: false,
      reason: "empty_body",
      issues: [{ path: "", message: "Request body is empty" }],
    };
  }

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return {
      ok: false,
      reason: "invalid_json",
      issues: [{ path: "", message: "Body is not valid JSON" }],
    };
  }

  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    return {
      ok: false,
      reason: "invalid_body",
      issues: parsed.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    };
  }
  return { ok: true, data: parsed.data as import("zod").infer<S> };
}

/**
 * Optional behaviors for adoption-sensitive routes.
 *
 * `emptyAsEmptyObject`: some write routes legitimately receive NO body and
 * treat that as a benign default (the bell's mark-all fires with an empty
 * body; a no-op delete sends nothing). Those routes adopt validation without
 * changing their contract by validating `{}` for the absent body instead of
 * failing with 400. A non-empty body is still fully validated.
 */
export interface ParseJsonBodyOptions {
  emptyAsEmptyObject?: boolean;
}

/**
 * Read and validate a JSON request body.
 *
 * Usage:
 *   const body = await parseJsonBody(request, clientCreateSchema);
 *   if (!body.ok) return body.response;
 *   body.data.name // typed
 */
export async function parseJsonBody<S extends ZodType>(
  request: Request,
  schema: S,
  options?: ParseJsonBodyOptions
): Promise<
  { ok: true; data: import("zod").infer<S> } | { ok: false; response: NextResponse }
> {
  let raw: string;
  try {
    raw = await request.text();
  } catch {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Could not read the request body", code: "unreadable_body" },
        { status: 400 }
      ),
    };
  }
  if (options?.emptyAsEmptyObject && raw.trim().length === 0) raw = "{}";

  const result = validateJson(raw, schema);
  if (result.ok) return { ok: true, data: result.data };

  const status = result.reason === "too_large" ? 413 : 400;
  return {
    ok: false,
    response: NextResponse.json(
      {
        error:
          result.reason === "too_large"
            ? "Request body is too large"
            : "Invalid request body",
        code: result.reason,
        issues: result.issues,
      },
      { status }
    ),
  };
}
