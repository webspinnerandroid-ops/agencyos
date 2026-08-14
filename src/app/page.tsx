import Link from "next/link";
import { createClient } from "@supabase/supabase-js";
import { Button } from "@/components/ui/button";
import MobileNav from "@/components/MobileNav";
import ThemeToggle from "@/components/ThemeToggle";
import ScreenshotSlideshow from "@/components/ScreenshotSlideshow";
import { Check, ArrowRight, Zap, Users, Globe, Shield, Brain, Calendar } from "lucide-react";
import { getLandingContent } from "@/lib/landing-content-server";

export const dynamic = "force-dynamic";

/**
 * Global hero-media setting (managed in Dashboard → Settings → Website /
 * Landing Page): 'slideshow' (default) or an inline 'video' URL.
 */
async function getHeroMedia(): Promise<{ mode: string; videoUrl: string }> {
  try {
    const db = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );
    const { data } = await db
      .from("site_settings")
      .select("hero_mode, hero_video_url")
      .eq("id", 1)
      .maybeSingle();
    return {
      mode: data?.hero_mode === "video" ? "video" : "slideshow",
      videoUrl: data?.hero_video_url ?? "",
    };
  } catch {
    return { mode: "slideshow", videoUrl: "" };
  }
}

const productSlides = [
  {
    src: "/screenshots/slide-dashboard.png",
    title: "Command Center",
    description: "Every client, campaign, and recent activity in one dashboard — recent content, media, and SEO campaign status at a glance.",
  },
  {
    src: "/screenshots/slide-generate.png",
    title: "AI Content Studio",
    description: "Brief a blog post and your AI team writes it end-to-end — SEO structure, relevant inline images, and internal links pulled from your client's knowledge base.",
  },
  {
    src: "/screenshots/slide-images.png",
    title: "Image Studio",
    description: "Generate brand-consistent visuals on demand, then drop them straight into your posts and calendar.",
  },
  {
    src: "/screenshots/slide-ai-team.png",
    title: "Your AI Team",
    description: "Eleven specialists — content, social, SEO, legal, performance, and more — each with their own tools, guidelines, and workspaces.",
  },
  {
    src: "/screenshots/slide-chat.png",
    title: "Team Chat",
    description: "Talk to your project manager, get handed off to the right specialist, and watch work land in the thread — all in one chat.",
  },
  {
    src: "/screenshots/slide-calendar.png",
    title: "Content Calendar",
    description: "Proposed campaigns, drafts, scheduled posts, and published content side by side — one view of everything your clients are getting.",
  },
  {
    src: "/screenshots/slide-seo.png",
    title: "SEO Audits & Proposals",
    description: "Honest, estimate-labeled campaign proposals your clients can actually act on — no invented rankings or fake ROI.",
  },
];

const landingNavSections = [
  {
    label: "Menu",
    items: [
      { href: "#features", label: "Features" },
      { href: "#how-it-works", label: "How it works" },
      { href: "#pricing", label: "Pricing" },
      { href: "#faq", label: "FAQ" },
    ],
  },
];

const plans = [
  {
    name: "Foundation",
    price: "49",
    description: "Everything on the platform, at starter levels.",
    features: ["All six hubs included", "4 blogs / 40 socials per month", "40 images, 8 videos per month", "200K AI tokens / month", "Content calendar + approvals", "White-label portal", "Email support"],
    planId: "foundation",
  },
  {
    name: "Growth",
    price: "99",
    description: "For growing agencies with multiple clients.",
    features: ["All six hubs included", "12 blogs / 150 socials per month", "150 images, 30 videos per month", "750K AI tokens / month", "SEO campaign automation", "Competitor analysis", "Priority support"],
    planId: "growth",
    popular: true,
  },
  {
    name: "Dominance",
    price: "299",
    description: "Full-scale content engine, white-label ready.",
    features: ["All six hubs included", "40 blogs / 500 socials per month", "500 images, 120 videos per month", "2.5M AI tokens / month", "Outreach + link building", "Dedicated account manager", "Custom integrations"],
    planId: "dominance",
  },
];

// Hub-and-spoke: a-la-carte add-ons for buyers who want just one piece.
const hubs = [
  { name: "Content Hub", price: "29", blurb: "Blogs, SEO scoring, content calendar + publish" },
  { name: "Social Hub", price: "29", blurb: "Captions, scheduling, approvals, 3 profiles" },
  { name: "Video Hub", price: "29", blurb: "Text-to-video & image-to-video generation" },
  { name: "Website Hub", price: "29", blurb: "Web Builder — build and host client sites" },
  { name: "Outreach Hub", price: "29", blurb: "Guest posts, reply watching, opportunities" },
  { name: "AI Team", price: "49", blurb: "The full employee roster, chat + campaigns" },
];

// Icons for the features grid — cycled when the super admin adds more than six.
const featureIcons = [Brain, Globe, Calendar, Shield, Zap, Users];

export default async function LandingPage() {
  const hero = await getHeroMedia();
  const content = await getLandingContent();

  return (
    <div className="min-h-screen bg-background">
      {/* Nav */}
      <header className="border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex items-center justify-between h-16">
          <div className="flex items-center gap-2">
            {process.env.NEXT_PUBLIC_BRAND_LOGO_URL ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={process.env.NEXT_PUBLIC_BRAND_LOGO_URL}
                alt="Agency OS"
                className="h-9 w-auto object-contain"
              />
            ) : (
              <>
                <Brain className="size-6 text-primary" />
                <span className="text-xl font-bold tracking-tight">Agency OS</span>
              </>
            )}
          </div>
          <div className="hidden sm:flex items-center gap-4">
            <a href="#features" className="text-sm text-muted-foreground hover:text-foreground transition-colors">Features</a>
            <a href="#how-it-works" className="text-sm text-muted-foreground hover:text-foreground transition-colors">How it works</a>
            <a href="#pricing" className="text-sm text-muted-foreground hover:text-foreground transition-colors">Pricing</a>
            <a href="#faq" className="text-sm text-muted-foreground hover:text-foreground transition-colors">FAQ</a>
          </div>
          <div className="flex items-center gap-4">
            <div className="sm:hidden">
              <MobileNav sections={landingNavSections} breakpointClass="sm:hidden" />
            </div>
            <ThemeToggle />
            <Link href="/login"><Button variant="ghost">Sign In</Button></Link>
            <Link href="/register"><Button>Get Started <ArrowRight className="size-4 ml-2" /></Button></Link>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="py-20 lg:py-32">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tight max-w-4xl mx-auto">
            {content.heroTitle}
          </h1>
          <p className="mt-6 text-lg sm:text-xl text-muted-foreground max-w-2xl mx-auto">
            {content.heroSubtitle}
          </p>
          <div className="mt-10 flex items-center justify-center gap-4 flex-wrap">
            <Link href="/register"><Button size="lg">Start Free Trial <ArrowRight className="size-4 ml-2" /></Button></Link>
            <Link href="/login"><Button variant="outline" size="lg">Sign In</Button></Link>
          </div>
          <p className="mt-4 text-sm text-muted-foreground">{content.heroBadge}</p>
        </div>
      </section>

      {/* Product tour — live screenshots */}
      <section className="pb-20">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-10">
            <div className="text-sm font-semibold text-muted-foreground uppercase tracking-widest mb-2">Product tour</div>
            <h2 className="text-3xl font-bold tracking-tight">See Agency OS in action</h2>
            <p className="mt-3 text-muted-foreground max-w-xl mx-auto">
              From campaign brief to published content — here&apos;s what your clients get.
            </p>
          </div>
          {hero.mode === "video" && hero.videoUrl ? (
            <div className="overflow-hidden rounded-lg border bg-black shadow-sm aspect-video">
              <video
                src={hero.videoUrl}
                controls
                autoPlay
                muted
                loop
                playsInline
                className="w-full h-full object-cover"
              />
            </div>
          ) : (
            <ScreenshotSlideshow slides={productSlides} />
          )}
        </div>
      </section>

      {/* Social proof — client logo strip + testimonials (managed in the page builder) */}
      {(content.logos.length > 0 || content.testimonials.length > 0) && (
        <section className="pb-20">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            {content.logos.length > 0 && (
              <>
                <h2 className="text-center text-sm font-semibold text-muted-foreground uppercase tracking-widest mb-8">
                  {content.logoStripHeading}
                </h2>
                <div className="flex flex-wrap items-center justify-center gap-x-10 gap-y-6 mb-12">
                  {content.logos.map((logo) => (
                    <span key={logo.name + logo.url} className="inline-flex items-center gap-2">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={logo.url}
                        alt={logo.name}
                        className="h-8 w-auto object-contain opacity-70 hover:opacity-100 transition-opacity"
                      />
                      {logo.href ? (
                        <a
                          href={logo.href}
                          target="_blank"
                          rel="noreferrer"
                          className="sr-only"
                        >
                          {logo.name}
                        </a>
                      ) : null}
                    </span>
                  ))}
                </div>
              </>
            )}
            {content.testimonials.length > 0 && (
              <>
                {content.testimonialsHeading && (
                  <h2 className="text-center text-2xl font-bold tracking-tight mb-8">
                    {content.testimonialsHeading}
                  </h2>
                )}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-4xl mx-auto">
                  {content.testimonials.map((t) => (
                    <div key={t.quote} className="rounded-xl border bg-card p-6">
                      <div className="text-sm text-muted-foreground italic">
                        &ldquo;{t.quote}&rdquo;
                      </div>
                      {t.author && (
                        <div className="mt-4 text-sm font-medium">— {t.author}</div>
                      )}
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </section>
      )}

      {/* Features */}
      <section id="features" className="py-20 bg-muted/30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl font-bold tracking-tight">{content.featuresHeading}</h2>
            <p className="mt-4 text-muted-foreground max-w-2xl mx-auto">{content.featuresSubheading}</p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-8">
            {content.features.map((f, i) => {
              const Icon = featureIcons[i % featureIcons.length];
              return (
                <div key={f.title + i} className="flex flex-col items-center text-center p-6 rounded-xl bg-background border">
                  <Icon className="size-10 text-primary mb-4" />
                  <h3 className="text-lg font-semibold mb-2">{f.title}</h3>
                  <p className="text-sm text-muted-foreground">{f.description}</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* How it works */}
      <section id="how-it-works" className="py-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl font-bold tracking-tight">{content.howItWorksHeading}</h2>
            <p className="mt-4 text-muted-foreground max-w-2xl mx-auto">{content.howItWorksSubheading}</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {content.howItWorks.map((h, i) => (
              <div key={h.title + i} className="rounded-xl border bg-card p-6">
                <div className="text-3xl font-bold text-primary">{h.step}</div>
                <h3 className="text-lg font-semibold mt-3 mb-2">{h.title}</h3>
                <p className="text-sm text-muted-foreground">{h.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="py-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl font-bold tracking-tight">Simple, Transparent Pricing</h2>
            <p className="mt-4 text-muted-foreground max-w-2xl mx-auto">Start with a 14-day free trial. No credit card required. Upgrade anytime.</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 max-w-5xl mx-auto">
            {plans.map((plan) => (
              <div key={plan.planId} className={`relative rounded-xl border p-8 flex flex-col ${plan.popular ? "border-primary ring-2 ring-primary shadow-lg" : ""}`}>
                {plan.popular && <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-primary text-primary-foreground text-xs font-semibold px-3 py-1 rounded-full">Most Popular</div>}
                <h3 className="text-xl font-semibold">{plan.name}</h3>
                <p className="text-sm text-muted-foreground mt-1">{plan.description}</p>
                <div className="mt-6 mb-6">
                  <span className="text-4xl font-bold">${plan.price}</span>
                  <span className="text-muted-foreground">/month</span>
                </div>
                <ul className="space-y-3 flex-1">
                  {plan.features.map((f) => (
                    <li key={f} className="flex items-start gap-2 text-sm"><Check className="size-4 text-green-500 shrink-0 mt-0.5" />{f}</li>
                  ))}
                </ul>
                <Link href={`/register?plan=${plan.planId}`} className="mt-8"><Button className="w-full" variant={plan.popular ? "default" : "outline"}>{plan.popular ? "Start Free Trial" : "Get Started"} <ArrowRight className="size-4 ml-2" /></Button></Link>
              </div>
            ))}
          </div>

          {/* Hub-and-spoke: a-la-carte add-ons */}
          <div className="mt-14 max-w-5xl mx-auto">
            <h3 className="text-center text-lg font-semibold mb-1">Or pick just the hub you need</h3>
            <p className="text-center text-sm text-muted-foreground mb-8">A-la-carte add-ons — stack a few, or take an all-in-one tier above. Any 3 hubs for $69/mo.</p>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              {hubs.map((hub) => (
                <div key={hub.name} className="rounded-xl border p-5 text-center flex flex-col">
                  <h4 className="font-semibold">{hub.name}</h4>
                  <p className="text-xs text-muted-foreground mt-1 mb-3 flex-1">{hub.blurb}</p>
                  <p className="text-2xl font-bold">${hub.price}<span className="text-sm font-normal text-muted-foreground">/mo</span></p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section id="faq" className="py-20">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-bold tracking-tight">{content.faqHeading}</h2>
          </div>
          <div className="space-y-4">
            {content.faqs.map((f) => (
              <details key={f.q} className="group rounded-xl border bg-card p-6">
                <summary className="flex items-center justify-between cursor-pointer list-none font-medium">
                  {f.q}
                  <span className="text-muted-foreground group-open:rotate-45 transition-transform">+</span>
                </summary>
                <p className="mt-3 text-sm text-muted-foreground">{f.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-20 bg-primary text-primary-foreground">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h2 className="text-3xl font-bold tracking-tight">{content.ctaTitle}</h2>
          <p className="mt-4 text-primary-foreground/80 max-w-xl mx-auto">{content.ctaSubtitle}</p>
          <div className="mt-8">
            <Link href="/register"><Button variant="secondary" size="lg">{content.ctaButton} <ArrowRight className="size-4 ml-2" /></Button></Link>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t py-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-8 text-sm">
            <div>
              <div className="flex items-center gap-2 mb-2">
                <Brain className="size-5" />
                <span className="font-semibold text-base">Agency OS</span>
              </div>
              <p className="text-muted-foreground">The all-in-one platform for digital agencies. AI content, white-label portals, SEO proposals, and scheduling.</p>
            </div>
            <div>
              <div className="font-semibold mb-2">Product</div>
              <ul className="space-y-1.5 text-muted-foreground">
                <li><a href="#features" className="hover:text-foreground transition-colors">Features</a></li>
                <li><a href="#pricing" className="hover:text-foreground transition-colors">Pricing</a></li>
                <li><Link href="/register" className="hover:text-foreground transition-colors">Start Free Trial</Link></li>
                <li><Link href="/help" className="hover:text-foreground transition-colors">Help Center</Link></li>
              </ul>
            </div>
            <div>
              <div className="font-semibold mb-2">Company</div>
              <ul className="space-y-1.5 text-muted-foreground">
                <li><Link href="/about" className="hover:text-foreground transition-colors">About</Link></li>
                <li><Link href="/contact" className="hover:text-foreground transition-colors">Contact</Link></li>
                <li><Link href="/privacy" className="hover:text-foreground transition-colors">Privacy Policy</Link></li>
                <li><Link href="/terms" className="hover:text-foreground transition-colors">Terms of Service</Link></li>
              </ul>
            </div>
          </div>
          <div className="border-t mt-8 pt-6 text-center text-xs text-muted-foreground">
            <p>&copy; {new Date().getFullYear()} Agency OS. All rights reserved.</p>
          </div>
        </div>
      </footer>
    </div>
  );
}