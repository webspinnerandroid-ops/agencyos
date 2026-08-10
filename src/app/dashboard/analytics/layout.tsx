import type { Metadata } from "next";

export async function generateMetadata(): Promise<Metadata> {
  return {
    title: "Analytics",
    description: "Track post performance, engagement rates, and content metrics across all social platforms.",
  };
}

export default function AnalyticsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}