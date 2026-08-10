import Link from "next/link";
import { Brain } from "lucide-react";

export const metadata = {
  title: "About",
  description: "Learn about Agency OS — the all-in-one platform built for digital agencies.",
};

export default function AboutPage() {
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 flex items-center justify-between h-16">
          <Link href="/" className="flex items-center gap-2">
            <Brain className="size-6 text-primary" />
            <span className="text-xl font-bold tracking-tight">Agency OS</span>
          </Link>
          <Link href="/register" className="text-sm text-primary font-medium hover:underline">Start Free Trial</Link>
        </div>
      </header>
      <main className="max-w-3xl mx-auto px-4 sm:px-6 py-16">
        <h1 className="text-3xl font-bold tracking-tight">About Agency OS</h1>
        <p className="mt-6 text-muted-foreground leading-relaxed">
          Agency OS is an all-in-one platform built for digital agencies. It replaces a stack of separate tools —
          AI content generation, social scheduling, white-label client portals, SEO campaign proposals, and billing —
          with one workspace.
        </p>
        <p className="mt-4 text-muted-foreground leading-relaxed">
          We build for agencies that run on tight margins: predictable AI costs (bring your own API key), true multi-tenant
          data isolation, and client portals you can put your own brand on.
        </p>
        <h2 className="text-xl font-semibold mt-10">Contact</h2>
        <p className="mt-2 text-muted-foreground">
          Reach us at <a href="mailto:support@blissmedialab.com" className="text-primary hover:underline">support@blissmedialab.com</a>.
        </p>
      </main>
    </div>
  );
}