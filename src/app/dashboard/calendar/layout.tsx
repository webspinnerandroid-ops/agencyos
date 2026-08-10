import type { Metadata } from "next";

export async function generateMetadata(): Promise<Metadata> {
  return {
    title: "Content Calendar",
    description: "Plan, schedule, and reschedule social media posts with an interactive drag-and-drop calendar.",
  };
}

export default function CalendarLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}