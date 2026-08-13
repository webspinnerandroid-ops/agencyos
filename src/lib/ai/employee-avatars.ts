/**
 * Avatar image mapping for the AI employees.
 *
 * Images live in `public/team/` and are named after the employee's display
 * name (lowercased). The user supplies these files — e.g. `cheryl.png`,
 * `malory.png`, `ak.png`. If a file isn't present yet, `getEmployeeAvatar`
 * returns null and the UI falls back to the employee's initial.
 */

const AVATAR_FILENAMES: Record<string, string> = {
  penny: "cheryl",
  eva: "woodhouse",
  sonny: "pam",
  stan: "barry",
  rachel: "brett",
  scout: "ak",
  dev: "ray",
  gauge: "sterling",
  nina: "malory",
  juno: "lana",
  linda: "cyril",
};

const AVATAR_EXTS = [".png", ".jpg", ".jpeg", ".webp"] as const;

/**
 * Public URL of an employee's avatar image, or null when the file isn't
 * bundled yet (caller should render the initial fallback).
 *
 * Serves the optimized 128px thumbnail (regenerate with
 * `scripts/make-avatar-thumbs.ps1`); the 2MB originals stay in the repo as
 * the source of truth.
 */
export function getEmployeeAvatar(employeeKey: string): string | null {
  const base = AVATAR_FILENAMES[employeeKey];
  if (!base) return null;
  return `/team/${base}-128${AVATAR_EXTS[0]}`;
}

/** Filenames the user should drop into `public/team/` (for setup docs). */
export const EMPLOYEE_AVATAR_FILENAMES: string[] = Object.values(
  AVATAR_FILENAMES
).map((base) => `${base}${AVATAR_EXTS[0]}`);
