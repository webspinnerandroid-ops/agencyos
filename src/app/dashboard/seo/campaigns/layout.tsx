import type { Metadata } from "next";

export async function generateMetadata(): Promise<Metadata> {
  return {
    title: "SEO Audits",
    description:
      "SEO audits with customized tiered proposals for your clients. Automated site crawling, competitor analysis, and price-tier recommendations.",
  };
}

export default function SeoCampaignsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}