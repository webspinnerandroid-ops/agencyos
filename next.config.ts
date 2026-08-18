import type { NextConfig } from "next";
import path from "path";
import fs from "fs";
import { execSync } from "child_process";

// Baked at build time: the version of the deployed source. Surfaced via the
// /api/version route and the account menu so it's easy to verify a phone is
// actually running the newest bundle after an update.
//
// Priority: (1) public/version.txt written by the deploy script before the
// upload (the VPS build has no .git to ask), (2) git HEAD locally/CI, (3) the
// fallback string. The deploy script writes version.txt on every deploy, so
// the indicator always reflects the freshly uploaded source.
function buildSha(): string {
  try {
    const baked = fs
      .readFileSync(path.join(process.cwd(), "public", "version.txt"), "utf8")
      .trim();
    if (baked) return baked;
  } catch {
    // no version.txt — fall through
  }
  try {
    return execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), interest-cohort=()",
  },
  // Relaxed CSP, tested on staging before tightening further:
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://*.supabase.co https://www.googletagmanager.com",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https: https://*.google-analytics.com https://www.googletagmanager.com",
      "media-src 'self' blob: https: https://*.b-cdn.net",
      "font-src 'self' data: https://fonts.gstatic.com",
      "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://api.deepseek.com https://api.openai.com https://generativelanguage.googleapis.com https://*.b-cdn.net",
      "frame-src 'self'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join("; "),
  },
];

const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_BUILD_SHA: buildSha(),
  },
  poweredByHeader: false,
  // puppeteer-core is dynamically imported only for the optional headless
  // competitor-crawl fallback; keep it external so it resolves from
  // node_modules at runtime (and isn't pulled into the client bundle).
  serverExternalPackages: ["puppeteer-core"],
  typescript: {
    ignoreBuildErrors: false,
  },
  // Anchors the Turbopack build to the app directory. Prevents Next 16's
  // workspace-root inference from being fooled by a parent package.json.
  turbopack: {
    root: path.resolve(process.cwd()),
  },
  experimental: {
    serverActions: {
      bodySizeLimit: "50mb",
    },
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;