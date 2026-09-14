"use client";

import { useState } from "react";
import Link from "next/link";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import {
  Key,
  Palette,
  Users,
  Link2,
  Clapperboard,
  ShieldCheck,
  Handshake,
  Send,
  MessageSquare,
  Building2,
  User,
  Globe,
  Share2,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Settings IA (design-audit P1): nine look-alike cards became five grouped
 * tabs. Every card keeps its real href — this page stays a hub, it just no
 * longer makes you scroll five identical screens to find one setting.
 */
type SettingsCard = {
  href: string;
  icon: LucideIcon;
  title: string;
  description: string;
};
type SettingsTab = {
  id: string;
  label: string;
  cards: SettingsCard[];
};

const TABS: SettingsTab[] = [
  {
    id: "account",
    label: "Account",
    cards: [
      {
        href: "/dashboard/profile",
        icon: User,
        title: "Profile & Usage",
        description: "Your account, token usage, and personal preferences.",
      },
      {
        href: "/dashboard/settings/security",
        icon: ShieldCheck,
        title: "Security (2FA)",
        description: "Two-factor authentication with an authenticator app.",
      },
      {
        href: "/dashboard/settings/admin-access",
        icon: Handshake,
        title: "Admin Assistance",
        description:
          "Opt in to let platform support sign in to your panel (one-way).",
      },
    ],
  },
  {
    id: "workspace",
    label: "Workspace",
    cards: [
      {
        href: "/dashboard/workspaces",
        icon: Building2,
        title: "Workspaces",
        description:
          "Create workspaces per client, with their own knowledgebase and brand.",
      },
      {
        href: "/dashboard/settings/white-label",
        icon: Palette,
        title: "White-Label",
        description: "Logo, brand colour, and custom domain.",
      },
      {
        href: "/dashboard/settings/ai",
        icon: Key,
        title: "AI Settings",
        description: "Manage API keys and task-model mappings.",
      },
    ],
  },
  {
    id: "integrations",
    label: "Integrations",
    cards: [
      {
        href: "/dashboard/connections",
        icon: Users,
        title: "Connections",
        description:
          "Onboard Google, Google Business Profile, and social accounts in one place.",
      },
      {
        href: "/dashboard/settings/telegram",
        icon: Send,
        title: "Telegram",
        description:
          "Get notifications on your phone and message your AI team from anywhere.",
      },
      {
        href: "/dashboard/settings/discord",
        icon: MessageSquare,
        title: "Discord",
        description:
          "Message your AI team from a Discord DM and mirror notifications there.",
      },
    ],
  },
  {
    id: "publishing",
    label: "Publishing",
    cards: [
      {
        href: "/dashboard/settings/blog",
        icon: Link2,
        title: "Blog Platforms",
        description: "Connect WordPress, Joomla, and more.",
      },
      {
        href: "/dashboard/settings/social",
        icon: Share2,
        title: "Social & Make.com",
        description:
          "Connect social accounts or publish through your Make.com webhook.",
      },
      {
        href: "/dashboard/settings/site",
        icon: Globe,
        title: "Website / Landing Page",
        description:
          "Switch the sales page product tour between slideshow and video.",
      },
    ],
  },
  {
    id: "site",
    label: "Site",
    cards: [
      {
        href: "/dashboard/cms",
        icon: Clapperboard,
        title: "Website Builder",
        description: "Edit the pages of your public website.",
      },
      {
        href: "/dashboard/settings/site",
        icon: Globe,
        title: "Landing Experience",
        description:
          "Product tour format for the sales page (slideshow or video).",
      },
    ],
  },
];

export default function SettingsIndexPage() {
  const [active, setActive] = useState(TABS[0].id);
  const tab = TABS.find((t) => t.id === active) ?? TABS[0];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Settings</h1>
        <p className="text-muted-foreground mt-1">
          Configure your agency platform.
        </p>
      </div>

      <div
        role="tablist"
        aria-label="Settings categories"
        className="flex flex-wrap gap-1.5 rounded-lg border bg-muted/40 p-1"
      >
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={active === t.id}
            onClick={() => setActive(t.id)}
            className={cn(
              "min-h-11 rounded-md px-4 text-sm font-medium transition-colors",
              active === t.id
                ? "bg-background shadow-sm text-foreground"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div
        role="tabpanel"
        aria-label={tab.label}
        className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4"
      >
        {tab.cards.map((c) => (
          <Link key={c.href + c.title} href={c.href}>
            <Card className="hover:border-primary transition-colors cursor-pointer h-full">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <c.icon className="size-4 text-primary" />
                  {c.title}
                </CardTitle>
                <CardDescription>{c.description}</CardDescription>
              </CardHeader>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
