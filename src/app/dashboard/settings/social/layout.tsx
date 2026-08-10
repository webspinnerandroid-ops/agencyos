import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Social Accounts — Agency OS",
  description: "Connect and manage your social media accounts.",
};

export default function SocialAccountsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}