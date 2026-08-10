import Link from "next/link";
import { Brain } from "lucide-react";

export const metadata = {
  title: "Terms of Service",
  description: "Agency OS terms of service — the agreement governing your use of the platform.",
};

export default function TermsPage() {
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
        <h1 className="text-3xl font-bold tracking-tight">Terms of Service</h1>
        <p className="mt-2 text-sm text-muted-foreground">Last updated: August 2026</p>

        <h2 className="text-xl font-semibold mt-8">1. Acceptance of Terms</h2>
        <p className="mt-2 text-muted-foreground leading-relaxed">
          By creating an account or using Agency OS, you agree to these Terms of Service and our Privacy Policy.
          If you do not agree, do not use the service.
        </p>

        <h2 className="text-xl font-semibold mt-8">2. Use of the Service</h2>
        <p className="mt-2 text-muted-foreground leading-relaxed">
          You may use Agency OS only for lawful purposes and in accordance with these terms. You are responsible for
          all activity under your account, including content generated for your clients and any AI API keys you add.
        </p>

        <h2 className="text-xl font-semibold mt-8">3. Subscriptions & Billing</h2>
        <p className="mt-2 text-muted-foreground leading-relaxed">
          Plans are billed monthly and renew automatically until canceled. The 14-day free trial requires no credit
          card. You can manage your subscription and payment method from the Billing page. AI usage may be subject to
          plan limits; overages may require an upgrade.
        </p>

        <h2 className="text-xl font-semibold mt-8">4. Bring-Your-Own-Key</h2>
        <p className="mt-2 text-muted-foreground leading-relaxed">
          When you provide your own API keys, you are responsible for all costs, terms, and usage of that provider.
          Agency OS is not responsible for the output, availability, or pricing of third-party AI providers.
        </p>

        <h2 className="text-xl font-semibold mt-8">5. Acceptable Use</h2>
        <p className="mt-2 text-muted-foreground leading-relaxed">
          You may not use the service to generate unlawful, infringing, or harmful content, or to facilitate abuse,
          fraud, or spam. We may suspend accounts that violate these terms.
        </p>

        <h2 className="text-xl font-semibold mt-8">6. Limitation of Liability</h2>
        <p className="mt-2 text-muted-foreground leading-relaxed">
          To the maximum extent permitted by law, Agency OS is provided "as is" without warranties, and our
          aggregate liability is limited to the amount you paid in the prior twelve months.
        </p>

        <h2 className="text-xl font-semibold mt-8">7. Contact</h2>
        <p className="mt-2 text-muted-foreground leading-relaxed">
          Questions about these terms? Contact <a href="mailto:support@blissmedialab.com" className="text-primary hover:underline">support@blissmedialab.com</a>.
        </p>
      </main>
    </div>
  );
}