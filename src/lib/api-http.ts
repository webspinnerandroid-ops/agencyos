import { NextRequest, NextResponse } from "next/server";

/**
 * Shared API-route helpers.
 *
 * Two failure classes this module standardizes (from the security audit):
 *
 * 1. UNGUARDED `request.formData()` — throws `SyntaxError` on JSON, empty, or
 *    otherwise non-form bodies, which surfaces as an unhelpful 500. Any
 *    endpoint that only accepts form uploads should parse through
 *    `safeFormData()` and answer 415 for everything else.
 *
 * 2. STACK-TRACE LEAKAGE — catch blocks that return `error.message` hand
 *    internal details (connection strings, SQL fragments, file paths) to the
 *    client. `internalErrorResponse()` logs the real error server-side and
 *    returns a generic message.
 */

/** True when the request carries a form body (multipart or urlencoded). */
export function isFormRequest(request: NextRequest): boolean {
  const contentType = request.headers.get("content-type") ?? "";
  return (
    contentType.includes("multipart/form-data") ||
    contentType.includes("application/x-www-form-urlencoded")
  );
}

/**
 * Parse a form body without ever throwing. Returns null when the request
 * isn't a form (respond 415) or when parsing fails (malformed multipart).
 */
export async function safeFormData(
  request: NextRequest
): Promise<FormData | null> {
  if (!isFormRequest(request)) return null;
  try {
    return await request.formData();
  } catch {
    return null;
  }
}

/** Standard 415 response for form-only endpoints that received another body. */
export function unsupportedMediaResponse(): NextResponse {
  return NextResponse.json(
    { error: "Expected a multipart/form-data (or urlencoded) request body" },
    { status: 415 }
  );
}

/**
 * Log the real error server-side and return a sanitized 500. Never include
 * exception messages or stacks in the response body.
 */
export function internalErrorResponse(
  error: unknown,
  route: string
): NextResponse {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[api:${route}]`, message, error instanceof Error ? error.stack : "");
  return NextResponse.json(
    { error: "Internal server error" },
    { status: 500 }
  );
}
