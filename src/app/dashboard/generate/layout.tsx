import type { Metadata } from "next";

export async function generateMetadata(): Promise<Metadata> {
  return {
    title: "Generate Content",
    description: "AI‑powered blog post and social media content generation. Create, copy, and publish in seconds.",
  };
}

export default function GenerateLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}