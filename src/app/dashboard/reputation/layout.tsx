import type { Metadata } from "next";

export async function generateMetadata(): Promise<Metadata> {
  return {
    title: "Reputation",
    description:
      "Google review volume, rating trends, and unanswered-reply counts across every connected Business Profile listing.",
  };
}

export default function ReputationLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
