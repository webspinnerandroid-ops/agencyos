import Link from "next/link";
import { Brain } from "lucide-react";

export const metadata = {
  title: "Privacy Policy",
  description: "Agency OS privacy policy — how we handle your data, API keys, and client information.",
};

export default function PrivacyPage() {
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
        <h1 className="text-3xl font-bold tracking-tight">Privacy Policy</h1>
        <p className="mt-2 text-sm text-muted-foreground">Last updated: August 2026</p>

        <h2 className="text-xl font-semibold mt-8">1. Information We Collect</h2>
        <p className="mt-2 text-muted-foreground leading-relaxed">
          We collect account information (name, email, company), billing information processed by our payment provider,
          usage data (content generated, features used), and any content you or your clients create in the platform.
        </p>

        <h2 className="text-xl font-semibold mt-8">2. How We Use Your Information</h2>
        <p className="mt-2 text-muted-foreground leading-relaxed">
          We use your information to operate the platform, process billing, provide support, and improve our service.
          We do not sell your personal data or your clients' data.
        </p>

        <h2 className="text-xl font-semibold mt-8">3. API Keys</h2>
        <p className="mt-2 text-muted-foreground leading-relaxed">
          API keys you add in Settings → AI are encrypted before storage and are used only to make requests to the
          AI provider you selected. They are never exposed to other tenants and are not used for any other purpose.
        </p>

        <h2 className="text-xl font-semibold mt-8">4. Data Isolation</h2>
        <p className="mt-2 text-muted-foreground leading-relaxed">
          Agency OS is a multi-tenant platform. Each agency's data — clients, content, workspaces, and keys — is
          isolated from every other tenant.
        </p>

        <h2 className="text-xl font-semibold mt-8">5. Data Retention</h2>
        <p className="mt-2 text-muted-foreground leading-relaxed">
          We retain your data while your account is active. Upon cancellation, billing data is retained as required by
          law and your content may be deleted after a reasonable period.
        </p>

        <h2 className="text-xl font-semibold mt-8">6. Contact</h2>
        <p className="mt-2 text-muted-foreground leading-relaxed">
          Questions about this policy? Contact <a href="mailto:support@blissmedialab.com" className="text-primary hover:underline">support@blissmedialab.com</a>.
        </p>
      </main>
    </div>
  );
}