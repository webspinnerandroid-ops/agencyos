import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Google Business Profile — Agency OS",
  description: "Connect and manage Google Business Profile listings.",
};

export default function GbpLayout({ children }: { children: React.ReactNode }) {
  return children;
}