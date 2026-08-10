import { redirect } from "next/navigation";
import { getRole } from "@/lib/auth";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  let role: string | null = null;
  try {
    role = await getRole();
  } catch {
    // no cookie -> not authenticated
  }

  if (role !== "super_admin") {
    redirect("/dashboard");
  }

  return <>{children}</>;
}