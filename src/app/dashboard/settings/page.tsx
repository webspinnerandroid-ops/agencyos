import Link from "next/link";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Key, Palette, Users, Link2, Clapperboard, ShieldCheck, Handshake, Send, MessageSquare } from "lucide-react";

const links = [
  { href: "/dashboard/settings/ai", icon: Key, title: "AI Settings", description: "Manage API keys and task-model mappings." },
  { href: "/dashboard/settings/admin-access", icon: Handshake, title: "Admin Assistance", description: "Opt in to let platform support sign in to your panel (one-way)." },
  { href: "/dashboard/settings/white-label", icon: Palette, title: "White-Label", description: "Logo, brand colour, and custom domain." },
  { href: "/dashboard/connections", icon: Users, title: "Connections", description: "Onboard Google, Google Business Profile, and social accounts in one place." },
  { href: "/dashboard/settings/blog", icon: Link2, title: "Blog Platforms", description: "Connect WordPress, Joomla, and more." },
  { href: "/dashboard/settings/site", icon: Clapperboard, title: "Website / Landing Page", description: "Switch the sales page product tour between slideshow and video." },
  { href: "/dashboard/settings/security", icon: ShieldCheck, title: "Security (2FA)", description: "Two-factor authentication with an authenticator app." },
  { href: "/dashboard/settings/telegram", icon: Send, title: "Telegram", description: "Get notifications on your phone and message your AI team from anywhere." },
  { href: "/dashboard/settings/discord", icon: MessageSquare, title: "Discord", description: "Message your AI team from a Discord DM and mirror notifications there." },
];

export default function SettingsIndexPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Settings</h1>
        <p className="text-muted-foreground mt-1">Configure your agency platform.</p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {links.map((l) => (
          <Link key={l.href} href={l.href}>
            <Card className="hover:border-primary transition-colors cursor-pointer h-full">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base"><l.icon className="size-4 text-primary" />{l.title}</CardTitle>
                <CardDescription>{l.description}</CardDescription>
              </CardHeader>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}