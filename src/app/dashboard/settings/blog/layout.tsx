import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Blog Platforms — Agency OS",
  description: "Connect WordPress, Joomla, and other blog platforms.",
};

export default function BlogPlatformsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}