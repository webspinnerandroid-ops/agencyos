import Link from "next/link";
import { Brain } from "lucide-react";

export const metadata = {
  title: "Contact",
  description: "Contact the Agency OS team for support, sales, and partnership inquiries.",
};

export default function ContactPage() {
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
        <h1 className="text-3xl font-bold tracking-tight">Contact Us</h1>
        <p className="mt-4 text-muted-foreground leading-relaxed">
          We'd love to hear from you. For support, billing, or partnership questions, reach out:
        </p>
        <div className="mt-6 rounded-xl border bg-card p-6 space-y-3">
          <div>
            <span className="font-medium">Support & Billing:</span>{" "}
            <a href="mailto:support@blissmedialab.com" className="text-primary hover:underline">support@blissmedialab.com</a>
          </div>
          <div>
            <span className="font-medium">Sales / Demos:</span>{" "}
            <a href="mailto:sales@blissmedialab.com" className="text-primary hover:underline">sales@blissmedialab.com</a>
          </div>
        </div>
        <p className="mt-6 text-sm text-muted-foreground">
          We typically respond within one business day.
        </p>
      </main>
    </div>
  );
}