import type { Metadata } from "next";

export async function generateMetadata(): Promise<Metadata> {
  return {
    title: "Billing",
    description: "Manage your subscription, view usage metrics, and download invoices.",
  };
}

export default function BillingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}