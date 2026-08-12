"use client";

import { useState } from "react";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import {
  Bot,
  Calendar,
  CircleHelp,
  Film,
  Key,
  LayoutDashboard,
  Megaphone,
  MessagesSquare,
  PhoneCall,
  Rocket,
  Settings2,
  Users2,
  Zap,
  Briefcase,
  PenTool,
  Search,
  TrendingUp,
  Globe,
  Star,
  Wrench,
} from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";

/* ------------------------------------------------------------------ */
/* Data                                                                 */
/* ------------------------------------------------------------------ */

const STATUS: Record<string, { label: string; className: string }> = {
  built: { label: "Backend built", className: "bg-green-100 text-green-700" },
  ui: { label: "Backend built — UI planned", className: "bg-yellow-100 text-yellow-700" },
  planned: { label: "Planned", className: "bg-gray-100 text-gray-600" },
};

const employees = [
  { icon: PenTool, name: "Cheryl", role: "SEO Content Writer", status: "built", desc: "Writes SEO-optimized blog posts, social captions, and content from the AI orchestrator (DeepSeek / OpenAI models). Constantly unhinged and dramatic — churns out chaotic streams of consciousness that somehow get results.", integrations: "DeepSeek, OpenAI, AI orchestrator" },
  { icon: MessagesSquare, name: "Woodhouse", role: "Executive Assistant (Inbox & Calendar)", status: "built", desc: "Connects Gmail or Outlook via OAuth, reads and triages unread email, syncs your calendar, and creates events. Timeless, deeply long-suffering, entirely accustomed to managing schedules under endless abuse. Drafting/replies and IMAP/POP accounts are on the roadmap.", integrations: "Gmail OAuth, Outlook / Microsoft Graph" },
  { icon: Users2, name: "Pam", role: "Social Media Manager", status: "built", desc: "Connects Facebook & Instagram (OAuth), schedules and posts to social platforms, and manages the social inbox via background workers. Loud, loves the spotlight, and handles public relations with zero filter.", integrations: "Facebook, Instagram, Meta API" },
  { icon: Zap, name: "Barry", role: "Lead Generation", status: "built", desc: "Captures and imports leads (including Apollo enrichment), sends outbound email via Resend, SMS via Twilio, and runs automated follow-up sequences. Relentless, aggressive, laser-focused on hunting down targets.", integrations: "Apollo, Resend, Twilio, sequences" },
  { icon: PhoneCall, name: "Brett", role: "Receptionist", status: "built", desc: "Handles inbound and outbound phone calls via the voice agent (TwiML webhooks). A call-management dashboard UI is planned. Perpetually caught in the line of fire as the primary target for everything going wrong.", integrations: "Twilio / telephony webhooks" },
  { icon: Globe, name: "AK", role: "Technical SEO Auditor", status: "built", desc: "Crawls websites, finds technical and on-page SEO issues, and discovers competitor domains for your campaigns. Obsessed with bizarre hidden mechanics and performing questionable experiments behind closed doors.", integrations: "Site crawler, competitor analysis" },
  { icon: Search, name: "Ray", role: "Web Developer", status: "built", desc: "Publishes content and web changes to WordPress sites. Webflow publishing is planned in Phase 5. Constantly dealing with broken infrastructure, putting out fires, and complaining about how underappreciated his technical work is.", integrations: "WordPress API (Webflow planned)" },
  { icon: TrendingUp, name: "Sterling", role: "Performance Marketer", status: "built", desc: "Pulls engagement analytics via background workers. Meta Insights / X Analytics reporting is planned. Operates on raw ego and reckless luck, with a total disregard for ROI until it somehow works out.", integrations: "Analytics workers, Meta/X (planned)" },
  { icon: Briefcase, name: "Malory", role: "Project Manager", status: "built", desc: "Processes scheduled tasks and follow-up sequences, coordinates blog-generation tasks, and keeps deliverables on track. Runs a tight, highly toxic ship with an iron fist and a martini in hand.", integrations: "Inngest workers, task queues" },
  { icon: Star, name: "Lana", role: "Reputation Manager", status: "built", desc: "Manages Google Business Profile connections. Review monitoring and response automation are planned. Constantly doing damage control and yelling about how everyone else is ruining the brand.", integrations: "Google Business Profile" },
  { icon: Wrench, name: "Cyril", role: "Legal Assistant", status: "planned", desc: "Planned — drafts contracts, answers legal questions, and clarifies fine print for your agency and clients. Chronically nervous, deeply insecure, one minor spreadsheet error away from a complete psychological breakdown.", integrations: "AI drafting (planned)" },
];

const caseStudySteps = [
  { step: "1. Onboarding", icon: Briefcase, agent: "Malory", text: "Malory (Project Manager) builds the client's task plan, milestones, and check-ins. She sets up the workspace, assigns the team, and schedules the kickoff." },
  { step: "2. Kickoff & comms", icon: MessagesSquare, agent: "Woodhouse + Brett", text: "Woodhouse (Executive Assistant) handles onboarding emails, triages the client's inbox, and syncs the calendar. Brett (Receptionist) answers any client calls and books them into the calendar." },
  { step: "3. Technical audit", icon: Globe, agent: "AK", text: "AK (Technical SEO) crawls the client's website, identifies technical and on-page issues (speed, meta, schema, indexing), and flags quick wins and priorities." },
  { step: "4. Content engine", icon: PenTool, agent: "Cheryl", text: "Cheryl (SEO Content Writer) turns AK's audit + keyword research into SEO-optimized blog posts, captions, and image prompts using the AI orchestrator." },
  { step: "5. Web deployment", icon: Search, agent: "Ray", text: "Ray (Web Developer) publishes Cheryl's content and AK's fixes to the client's WordPress site — and will support Webflow in Phase 5." },
  { step: "6. Social growth", icon: Users2, agent: "Pam", text: "Pam (Social Media Manager) schedules posts, connects Facebook/Instagram, and manages the social inbox so every comment and message gets attention." },
  { step: "7. Lead machine", icon: Zap, agent: "Barry", text: "Barry (Lead Generation) enriches the client's leads via Apollo, runs email + SMS sequences with Resend/Twilio, and hands qualified leads back to the agency." },
  { step: "8. Performance", icon: TrendingUp, agent: "Sterling", text: "Sterling (Performance Marketer) pulls engagement analytics and reports on what's working, so budgets shift toward the highest-performing content." },
  { step: "9. Reputation", icon: Star, agent: "Lana", text: "Lana (Reputation Manager) keeps the Google Business Profile accurate and monitors the client's local presence and reviews." },
  { step: "10. Legal & wrap", icon: Wrench, agent: "Cyril", text: "Cyril (Legal Assistant, planned) drafts the engagement contract and any legal page copy, closing out the campaign cleanly." },
];

const faqs = [
  {
    q: "How does the 14-day free trial work?",
    a: "When you create an account, a brand-new agency tenant is created for you with a default workspace, a default brand profile, a trialing subscription, and a 14-day trial license. No credit card is required.",
  },
  {
    q: "Why doesn't my new user see their own data?",
    a: "Each agency is fully isolated (multi-tenant). Every account created from /register always generates a fresh tenant, so a new user can only see content inside their own tenant. If you ever see shared data, the account was assigned to an existing tenant — tell your Super Admin.",
  },
  {
    q: "Who can access the Super Admin panel?",
    a: "Only Super Admin level. They can see all tenants, licenses, users, and assign levels (User/Client, Editor, Admin, Super Admin) from the All Users table. Non-super-admins are redirected away from /dashboard/admin.",
  },
  {
    q: "How do I set up AI content generation?",
    a: "Go to Dashboard → AI settings, pick a provider (DeepSeek, OpenAI), add your API key (encrypted before storage), then map each task (Blog Generation, Social Caption, Image Generation) to a model in Task–Model Mapping. Active keys are used; inactive keys are ignored.",
  },
  {
    q: "How do I connect my email (Woodhouse)?",
    a: "Woodhouse connects via Gmail or Outlook OAuth. Today it reads and triages unread email and syncs your calendar. Drafting/replies and IMAP/POP accounts are on the roadmap. Tokens are encrypted at rest.",
  },
  {
    q: "How do I connect social accounts?",
    a: "Go to Dashboard → Settings → Social. Facebook and Instagram connect via OAuth. X, LinkedIn, YouTube, TikTok, Threads, and Pinterest are listed as supported; OAuth connect is being rolled out.",
  },
  {
    q: "How do I connect a WordPress blog?",
    a: "Go to Dashboard → Settings → Blog, add your WordPress site URL and credentials/app password. Ray (Web Developer) can then publish content to that site.",
  },
  {
    q: "What is a Workspace and how do I switch?",
    a: "Workspaces group work per client or brand. Every tenant has a default workspace. Use the header workspace switcher; each workspace has its own brand profile and knowledge base.",
  },
  {
    q: "How does the client portal work?",
    a: "Clients with the User/Client level get a branded portal to review posts and SEO proposals and approve or request changes — without seeing your internal dashboard.",
  },
  {
    q: "What happens when my license expires?",
    a: "The license status changes to expired and the tenant loses access to paid features until a new license is issued by the Super Admin (Admin → Issue License) or the plan is renewed from Billing.",
  },
];

const roadmap = [
  { title: "Agents Dashboard UI", status: "ui", desc: "All 11 AI employees exist as backend libs/APIs + workers today. A dashboard to manage, monitor, and 'hire' them is next." },
  { title: "Email replies", status: "planned", desc: "Draft, send, and reply from the connected Gmail/Outlook inbox (send scopes)." },
  { title: "IMAP / POP email support", status: "planned", desc: "Connect any standard email provider (cPanel, Hostinger, Dovecot, etc.)." },
  { title: "Video / Audio generation UI", status: "ui", desc: "Media generation APIs exist; a dashboard page to generate/browse video & voice is planned." },
  { title: "Webflow publishing", status: "planned", desc: "Phase 5 — publish to Webflow in addition to WordPress." },
  { title: "Google Search Console", status: "planned", desc: "Phase 5 — connect GSC to track keyword rankings and search performance." },
  { title: "Meta Insights / X Analytics", status: "planned", desc: "Phase 5 — pull engagement analytics from Meta and X." },
  { title: "SEO → Content enrichment", status: "planned", desc: "Feed competitor analysis and keywords from SEO campaigns into blog prompts." },
  { title: "Reputation review automation", status: "planned", desc: "Monitor and respond to Google reviews automatically." },
  { title: "Promo codes", status: "planned", desc: "Coupon/promo-code support for billing." },
];

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

export default function HelpPage() {
  const [faqOpen, setFaqOpen] = useState<number | null>(0);

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 flex items-center justify-between h-16">
          <div className="flex items-center gap-2">
            <Bot className="size-6 text-primary" />
            <span className="text-xl font-bold tracking-tight">Agency OS Help Center</span>
          </div>
          <div className="flex items-center gap-3">
            <Link href="/"><Button variant="ghost" size="sm">Home</Button></Link>
            <Link href="/login"><Button size="sm">Sign In</Button></Link>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-10 space-y-10">
        {/* Hero */}
        <div className="text-center">
          <h1 className="text-3xl sm:text-4xl font-bold tracking-tight">
            Everything you need to run your agency
          </h1>
          <p className="mt-3 text-muted-foreground max-w-2xl mx-auto">
            Setup guides, a full tool manual, your AI team, a client campaign case study, roadmap, and FAQs.
          </p>
        </div>

        <Tabs defaultValue="overview" className="w-full">
          <TabsList className="flex flex-wrap h-auto justify-start gap-1">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="setup">Setup</TabsTrigger>
            <TabsTrigger value="manual">User Manual</TabsTrigger>
            <TabsTrigger value="employees">AI Employees</TabsTrigger>
            <TabsTrigger value="casestudy">Case Study</TabsTrigger>
            <TabsTrigger value="roadmap">Roadmap</TabsTrigger>
            <TabsTrigger value="faq">FAQ</TabsTrigger>
          </TabsList>

          {/* ================= OVERVIEW ================= */}
          <TabsContent value="overview" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2"><LayoutDashboard className="size-5 text-primary" /> What is Agency OS?</CardTitle>
                <CardDescription>
                  The all-in-one platform for digital agencies: AI content, white-label client portals, SEO campaign proposals, social scheduling, leads, voice, and billing.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <p>Every agency gets its own fully isolated tenant. All content, SEO audits, clients, workspaces, blog settings, and AI settings are scoped to that tenant — no cross-tenant data leaks.</p>
                <div className="pt-2">
                  <h4 className="font-semibold mb-2 flex items-center gap-1.5"><Users2 className="size-4" /> Account Levels</h4>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="rounded-lg border p-4">
                      <div className="flex items-center justify-between"><span className="font-semibold">Super Admin</span><Badge className="bg-purple-100 text-purple-700">Platform-wide</Badge></div>
                      <p className="text-xs text-muted-foreground mt-1">Sees all tenants, licenses, users. Assigns levels and issues licenses.</p>
                    </div>
                    <div className="rounded-lg border p-4">
                      <div className="flex items-center justify-between"><span className="font-semibold">Admin</span><Badge variant="outline">Agency-wide</Badge></div>
                      <p className="text-xs text-muted-foreground mt-1">Full access to their agency: content, clients, SEO, workspaces, settings, billing, portal.</p>
                    </div>
                    <div className="rounded-lg border p-4">
                      <div className="flex items-center justify-between"><span className="font-semibold">Editor</span><Badge variant="outline">Content</Badge></div>
                      <p className="text-xs text-muted-foreground mt-1">Creates/edits content, runs SEO audits, manages the calendar.</p>
                    </div>
                    <div className="rounded-lg border p-4">
                      <div className="flex items-center justify-between"><span className="font-semibold">User / Client</span><Badge variant="outline">Client portal</Badge></div>
                      <p className="text-xs text-muted-foreground mt-1">Reviews and approves posts and SEO proposals through the branded portal.</p>
                    </div>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">New signups get a 14-day trial. Plans: Foundation $49, Growth $99, Dominance $299. They differ in monthly posts, social profiles, AI tokens, SEO automation, and white-label capabilities.</p>
              </CardContent>
            </Card>
          </TabsContent>

          {/* ================= SETUP ================= */}
          <TabsContent value="setup" className="space-y-6">
            {[
              {
                title: "Create your account",
                steps: [
                  "Go to /register and choose your plan (Foundation, Growth, Dominance, or Premium).",
                  "Enter your agency/company name, work email, and a password (min 8 characters).",
                  "Click Start Free Trial. A fresh tenant, default workspace, default brand profile, trialing subscription, and 14-day trial license are created.",
                  "Sign in at /login. You land on the Dashboard as an Admin of your own tenant.",
                ],
              },
              {
                title: "Set up AI (Cheryl — required before generating content)",
                icon: Key,
                steps: [
                  "Open Dashboard → AI (settings/ai).",
                  "Under Add API Key, choose a provider (e.g. DeepSeek, OpenAI) and paste your API key (encrypted before storage).",
                  "Click Add Key. It appears under Your API Keys with an Active badge.",
                  "Use Task–Model Mapping to assign which model handles Blog Generation, Social Caption, and Image Generation.",
                  "Toggle the Active switch to enable/disable a key, or delete it when done.",
                ],
              },
              {
                title: "Connect your email (Woodhouse)",
                icon: MessagesSquare,
                steps: [
                  "Woodhouse connects via Gmail or Outlook OAuth (authorize in the popup).",
                  "Today he reads and triages unread email and syncs the calendar (tokens encrypted at rest).",
                  "Drafting/replies and IMAP/POP accounts are on the roadmap.",
                ],
              },
              {
                title: "Connect a blog (Ray)",
                steps: [
                  "Open Dashboard → Settings → Blog.",
                  "Add your WordPress site URL, site name, and credentials/app password.",
                  "Once connected, Ray can publish generated content to that site. Webflow is planned.",
                ],
              },
              {
                title: "Connect social accounts (Pam)",
                steps: [
                  "Open Dashboard → Settings → Social.",
                  "Connect Facebook and Instagram via OAuth (authorize in the popup).",
                  "X, LinkedIn, YouTube, TikTok, Threads, Pinterest are supported; OAuth connect is rolling out.",
                ],
              },
              {
                title: "Connect Google Business Profile (Lana)",
                steps: [
                  "Open Dashboard → Settings → GBP.",
                  "Click connect and authorize with the Google account that manages the business profile.",
                  "Pick the location to link. Connected profiles are saved per tenant.",
                ],
              },
              {
                title: "White-label your portal",
                steps: [
                  "Open Dashboard → Settings → White Label.",
                  "Set your brand name, logo, colors, and custom domain.",
                  "Clients see your brand — not Agency OS — in their portal.",
                ],
              },
              {
                title: "Billing & upgrades",
                steps: [
                  "Open Dashboard → Billing to see your plan (Current Plan), Usage (Current Month), and Billing History.",
                  "Plans: Foundation $49/mo, Growth $99/mo, Dominance $299/mo. Upgrades use Stripe checkout.",
                  "The Super Admin can also issue licenses from Admin → Issue License.",
                ],
              },
            ].map((s) => (
              <Card key={s.title}>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">{s.icon && <s.icon className="size-5 text-primary" />} {s.title}</CardTitle>
                </CardHeader>
                <CardContent>
                  <ol className="list-decimal list-inside space-y-1.5 text-sm">
                    {s.steps.map((step, i) => <li key={i}>{step}</li>)}
                  </ol>
                </CardContent>
              </Card>
            ))}
          </TabsContent>

          {/* ================= MANUAL ================= */}
          <TabsContent value="manual" className="space-y-6">
            {[
              { title: "Dashboard", icon: LayoutDashboard, desc: "Overview of your agency activity. Filter by client, jump to Generate Content / Content Calendar / Generate Images, and see Recent Content, Recent Images, and Recent SEO Audits." },
              { title: "Generate Content (Cheryl)", icon: Zap, desc: "Enter a Topic, optional Brand Voice, optional Client, and pick Social Platforms (Instagram, Twitter/X, LinkedIn, Facebook, TikTok, Threads). Click Generate Content — you get a full blog post (title, slug, meta description, heading structure, body with 2,500-word check, suggested image prompt) plus per-platform captions, hashtags, first comments, and image descriptions." },
              { title: "Generate Images", icon: Film, desc: "AI image generation with prompt enhancement. Describe what you want; the platform enhances the prompt and generates an image you can reuse in content." },
              { title: "SEO Audits (AK + Cheryl)", icon: Megaphone, desc: "Run a site audit by entering a URL and clicking Run Audit. View generated audits and tiered proposals under Audits. Competitor discovery is included. Rankings tracking is coming soon (Google Search Console)." },
              { title: "Content Calendar", icon: Calendar, desc: "Plan and schedule posts across platforms in one view." },
              { title: "Workspaces", icon: Settings2, desc: "Manage workspaces per client/brand. Switch workspaces in the header. Each workspace has a Brand Profile and Knowledge Base for consistent, on-brand content." },
              { title: "Client Portal", icon: Users2, desc: "Clients log into a branded portal to review and approve posts and SEO proposals. They never see your internal dashboard." },
              { title: "Super Admin", icon: Settings2, desc: "Platform-wide: All Tenants, All Licenses (issue/revoke), and All Users — assign levels (User/Client, Editor, Admin, Super Admin) and see each user's Tenant, Plan, and Trial/status badge." },
            ].map((t) => (
              <Card key={t.title}>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2"><t.icon className="size-5 text-primary" /> {t.title}</CardTitle>
                </CardHeader>
                <CardContent className="text-sm text-muted-foreground">{t.desc}</CardContent>
              </Card>
            ))}
          </TabsContent>

          {/* ================= EMPLOYEES ================= */}
          <TabsContent value="employees" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2"><Bot className="size-5 text-primary" /> AI Employees</CardTitle>
                <CardDescription>
                  Your AI team — each employee automates a function of your agency. They run as backend modules + background workers today; a management dashboard UI is next.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {employees.map((a) => (
                    <div key={a.name} className="rounded-lg border p-4">
                      <div className="flex items-center justify-between">
                        <span className="text-lg font-bold">{a.name}</span>
                        <Badge className={STATUS[a.status].className}>{STATUS[a.status].label}</Badge>
                      </div>
                      <p className="text-sm font-semibold text-primary">{a.role}</p>
                      <p className="text-xs text-muted-foreground mt-2">{a.desc}</p>
                      <p className="text-[10px] text-muted-foreground mt-2"><span className="font-semibold">Integrations:</span> {a.integrations}</p>
                    </div>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground mt-4">Email integration note: Woodhouse connects via Gmail/Outlook OAuth to read and triage email and sync the calendar. Drafting & replying from the connected inbox, and IMAP/POP support, are on the roadmap.</p>
              </CardContent>
            </Card>
          </TabsContent>

          {/* ================= CASE STUDY ================= */}
          <TabsContent value="casestudy" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2"><Briefcase className="size-5 text-primary" /> Case Study — Onboarding & Running a Client Campaign</CardTitle>
                <CardDescription>
                  A 90-day SEO + web agency campaign, showing how all 11 employees work together.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {caseStudySteps.map((s) => (
                  <div key={s.step} className="rounded-lg border p-4">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <span className="font-semibold flex items-center gap-2"><s.icon className="size-4 text-primary" /> {s.step}</span>
                      <Badge variant="outline" className="font-mono text-xs">{s.agent}</Badge>
                    </div>
                    <p className="text-sm text-muted-foreground mt-1.5">{s.text}</p>
                  </div>
                ))}
                <div className="rounded-lg bg-muted/50 border p-4 text-sm text-muted-foreground">
                  <span className="font-semibold text-foreground">The result:</span> The client's site is technically sound (AK + Ray), publishing on-brand SEO content every week (Cheryl + Ray), active on social (Pam), triaging email and calls (Woodhouse + Brett), generating and converting leads (Barry), tracked for performance (Sterling), protected locally (Lana), contract-backed (Cyril), and coordinated end-to-end (Malory).
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* ================= ROADMAP ================= */}
          <TabsContent value="roadmap" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2"><Rocket className="size-5 text-primary" /> Roadmap</CardTitle>
                <CardDescription>Planned and partially-built features, from the project handoffs.</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {roadmap.map((r) => (
                    <div key={r.title} className="rounded-lg border p-4">
                      <div className="flex items-center justify-between">
                        <span className="font-semibold">{r.title}</span>
                        <Badge className={STATUS[r.status].className}>{STATUS[r.status].label}</Badge>
                      </div>
                      <p className="text-sm text-muted-foreground mt-1">{r.desc}</p>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* ================= FAQ ================= */}
          <TabsContent value="faq" className="space-y-4">
            {faqs.map((f, i) => {
              const open = faqOpen === i;
              return (
                <Card key={i}>
                  <button
                    type="button"
                    className="w-full text-left px-5 py-4 flex items-center justify-between gap-3 rounded-lg hover:bg-muted/40 transition-colors"
                    onClick={() => setFaqOpen(open ? null : i)}
                  >
                    <span className="font-semibold flex items-center gap-2">
                      <CircleHelp className="size-4 text-primary shrink-0" />
                      {f.q}
                    </span>
                    <span className="text-muted-foreground shrink-0">{open ? "−" : "+"}</span>
                  </button>
                  {open && (
                    <div className="px-5 pb-5 text-sm text-muted-foreground border-t pt-3">
                      {f.a}
                    </div>
                  )}
                </Card>
              );
            })}
          </TabsContent>
        </Tabs>

        {/* Footer */}
        <footer className="border-t pt-8 text-center text-sm text-muted-foreground">
          <p>&copy; {new Date().getFullYear()} Agency OS. All rights reserved.</p>
        </footer>
      </main>
    </div>
  );
}