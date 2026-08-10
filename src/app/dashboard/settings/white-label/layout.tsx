import type { Metadata } from "next";

export async function generateMetadata(): Promise<Metadata> {
  return {
    title: "White‑Label Settings",
    description:
      "Customise your client portal branding — upload a logo, choose a brand colour, and set a custom domain.",
  };
}

export default function WhiteLabelLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}