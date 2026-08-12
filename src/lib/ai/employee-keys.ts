/**
 * Canonical employee keys for the AI team.
 *
 * Kept in a plain (non-"use server") module on purpose: client components
 * (the chat UI) import EMPLOYEE_KEYS to list employees, and Turbopack mangles
 * `as const` arrays exported from "use server" files when they cross into the
 * client bundle. Server modules import it from here too, so there is exactly
 * one source of truth.
 */
export const EMPLOYEE_KEYS = [
  "penny", // Cheryl — content writer
  "eva", // Woodhouse — inbox & calendar
  "sonny", // Pam — social media
  "stan", // Barry — lead generation
  "rachel", // Brett — receptionist
  "scout", // AK — technical SEO
  "dev", // Ray — web developer
  "gauge", // Sterling — performance marketing
  "nina", // Malory — project manager
  "juno", // Lana — reputation
  "linda", // Cyril — legal
] as const;
