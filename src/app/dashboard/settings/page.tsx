import Link from "next/link";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Key, Palette, Globe, Users, Link2, Store, Clapperboard } from "lucide-react";

const links = [
  { href: "/dashboard/settings/ai", icon: Key, title: "AI Settings", description: "Manage API keys and task-model mappings." },
  { href: "/dashboard/settings/white-label", icon: Palette, title: "White-Label", description: "Logo, brand colour, and custom domain." },
  { href: "/dashboard/settings/social", icon: Users, title: "Social Accounts", description: "Connect social media platforms." },
  { href: "/dashboard/settings/blog", icon: Link2, title: "Blog Platforms", description: "Connect WordPress, Joomla, and more." },
  { href: "/dashboard/settings/gbp", icon: Store, title: "Google Business Profile", description: "Manage GBP listings." },
  { href: "/dashboard/settings/site", icon: Clapperboard, title: "Website / Landing Page", description: "Switch the sales page product tour between slideshow and video." },
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