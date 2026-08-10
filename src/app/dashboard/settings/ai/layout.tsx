import type { Metadata } from "next";

export async function generateMetadata(): Promise<Metadata> {
  return {
    title: "AI Settings",
    description: "Manage your AI provider API keys and configure which models handle each content-generation task.",
  };
}

export default function AiSettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}