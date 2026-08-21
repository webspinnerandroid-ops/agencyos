import Link from "next/link";
import { notFound } from "next/navigation";
import { getClient } from "../actions";
import DeleteClientButton from "../delete-client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowRight, ArrowLeft, Calendar, Globe, Users } from "lucide-react";
import { LIFECYCLE_STEPS } from "@/lib/client-lifecycle";

export default async function ClientDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const data = await getClient(id);
  if (!data) notFound();
  const { client, lifecycle } = data;
  const completed = lifecycle?.status === "completed";
  const step = lifecycle?.step ?? 0;

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex items-center justify-between">
        <Link href="/dashboard/clients">
          <Button variant="ghost" size="sm">
            <ArrowLeft className="size-3 mr-1" /> All clients
          </Button>
        </Link>
        <div className="flex items-center gap-2">
          <Link href={`/dashboard/clients/${id}/onboarding`}>
            <Button size="sm" variant="outline">
              {completed ? "View onboarding" : "Continue onboarding"}
              <ArrowRight className="size-3 ml-1" />
            </Button>
          </Link>
          <DeleteClientButton clientId={id} clientName={client.name} />
        </div>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Users className="size-5" /> {client.name}
              </CardTitle>
              <CardDescription className="text-sm mt-1">
                {client.website ? (
                  <a href={client.website} target="_blank" rel="noreferrer" className="hover:underline inline-flex items-center gap-1">
                    <Globe className="size-3" /> {client.website}
                  </a>
                ) : (
                  "No website yet"
                )}
              </CardDescription>
            </div>
            {completed ? (
              <Badge className="bg-green-600 text-white shrink-0">Onboarding complete</Badge>
            ) : (
              <Badge variant="outline" className="shrink-0">
                Step {Math.min(step + 1, 6)} / 6
              </Badge>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {client.notes && (
            <p className="text-sm text-muted-foreground">{client.notes}</p>
          )}

          <div className="flex gap-1 pt-1">
            {LIFECYCLE_STEPS.map((s, i) => (
              <div
                key={s.id}
                title={s.label}
                className={`h-1.5 flex-1 rounded-full ${
                  completed || i <= step ? "bg-primary" : "bg-muted"
                }`}
              />
            ))}
          </div>
          <p className="text-xs text-muted-foreground flex items-center gap-1">
            <Calendar className="size-3" />
            {completed
              ? "All onboarding steps complete — the campaign is live."
              : `Next up: ${LIFECYCLE_STEPS[Math.min(step, 5)].label} — ${LIFECYCLE_STEPS[Math.min(step, 5)].description}`}
          </p>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 pt-2">
            <Link href={`/dashboard/clients/${id}/onboarding`}>
              <Button size="sm" variant="outline" className="w-full">Onboarding wizard</Button>
            </Link>
            <Link href="/dashboard/calendar">
              <Button size="sm" variant="outline" className="w-full">Calendar</Button>
            </Link>
            <Link href="/dashboard/seo/campaigns">
              <Button size="sm" variant="outline" className="w-full">SEO campaigns</Button>
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
