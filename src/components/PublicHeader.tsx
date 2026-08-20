import Link from "next/link";
import { Brain, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import MobileNav from "@/components/MobileNav";
import ThemeToggle from "@/components/ThemeToggle";
import { getLandingContent } from "@/lib/landing-content-server";

const landingNavSections = [
  {
    label: "Menu",
    items: [
      { href: "/#features", label: "Features" },
      { href: "/#how-it-works", label: "How it works" },
      { href: "/#pricing", label: "Pricing" },
      { href: "/#faq", label: "FAQ" },
    ],
  },
];

/**
 * The marketing-site header shared by every public page (landing, /blog,
 * /blog/<slug>, …). Reads the super-admin-managed nav links from the landing
 * content so the menu stays identical everywhere, and carries the theme
 * toggle + mobile drawer so public pages honor the saved light/dark choice.
 */
export default async function PublicHeader() {
  const content = await getLandingContent();

  const navSections = content.navLinks.length
    ? [
        ...landingNavSections,
        {
          label: "Pages",
          items: content.navLinks.map((l) => ({ href: l.href, label: l.label })),
        },
      ]
    : landingNavSections;

  return (
    <header className="border-b">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex items-center justify-between h-16">
        <div className="flex items-center gap-2 min-w-0">
          {process.env.NEXT_PUBLIC_BRAND_LOGO_URL ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={process.env.NEXT_PUBLIC_BRAND_LOGO_URL}
              alt="Agency OS"
              className="h-9 w-auto object-contain"
            />
          ) : (
            <>
              <Brain className="size-6 text-primary shrink-0" />
              <span className="text-xl font-bold tracking-tight whitespace-nowrap">Agency OS</span>
            </>
          )}
        </div>
        <div className="hidden sm:flex items-center gap-4">
          <Link href="/#features" className="text-sm text-muted-foreground hover:text-foreground transition-colors">Features</Link>
          <Link href="/#how-it-works" className="text-sm text-muted-foreground hover:text-foreground transition-colors">How it works</Link>
          <Link href="/#pricing" className="text-sm text-muted-foreground hover:text-foreground transition-colors">Pricing</Link>
          <Link href="/#faq" className="text-sm text-muted-foreground hover:text-foreground transition-colors">FAQ</Link>
          {content.navLinks.map((l) => (
            <Link key={l.href} href={l.href} className="text-sm text-muted-foreground hover:text-foreground transition-colors">{l.label}</Link>
          ))}
        </div>
        <div className="flex items-center gap-2 sm:gap-4">
          <div className="sm:hidden">
            <MobileNav sections={navSections} breakpointClass="sm:hidden" />
          </div>
          <ThemeToggle />
          <Link href="/login"><Button variant="ghost" size="sm">Sign In</Button></Link>
          {/* Get Started stays in the hero on mobile — hiding it here keeps
              the header to one line so the menu button stays tappable. */}
          <Link href="/register" className="hidden sm:inline-flex"><Button size="sm">Get Started <ArrowRight className="size-4 ml-2" /></Button></Link>
        </div>
      </div>
    </header>
  );
}
