"use client";

import { useState } from "react";
import { getEmployeeAvatar } from "@/lib/ai/employee-avatars";

/**
 * Circular avatar for an AI employee. Renders the employee's photo when the
 * file is bundled (`public/team/<name>.png`) and falls back to their initial
 * otherwise (or if the image fails to load).
 */
export function EmployeeAvatar({
  employeeKey,
  name,
  size = 40,
  className = "",
}: {
  employeeKey: string;
  name?: string;
  size?: number;
  className?: string;
}) {
  const src = getEmployeeAvatar(employeeKey);
  const [failed, setFailed] = useState(false);
  const initial = (name ?? "?").charAt(0).toUpperCase();

  const circleStyle: React.CSSProperties = {
    width: size,
    height: size,
    fontSize: Math.max(12, Math.round(size * 0.4)),
  };

  if (!src || failed) {
    return (
      <div
        className={`rounded-full bg-primary/10 text-primary font-semibold flex items-center justify-center shrink-0 select-none ${className}`}
        style={circleStyle}
        aria-label={name ?? "Employee"}
      >
        {initial}
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={name ?? "Employee"}
      width={size}
      height={size}
      onError={() => setFailed(true)}
      className={`rounded-full object-cover shrink-0 ${className}`}
      style={circleStyle}
    />
  );
}
