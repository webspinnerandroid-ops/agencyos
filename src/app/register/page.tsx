"use client";

import { useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, ArrowLeft, Check } from "lucide-react";
import Link from "next/link";

const PLANS = [
  { id: "starter", name: "Starter", price: "$49/mo", features: ["10 blog posts / month", "3 social profiles", "Basic AI content", "Content calendar", "Analytics dashboard"] },
  { id: "growth", name: "Growth", price: "$99/mo", features: ["50 blog posts / month", "10 social profiles", "Advanced AI content", "SEO campaign automation", "Competitor analysis"] },
  { id: "dominance", name: "Dominance", price: "$199/mo", features: ["Unlimited blog posts", "Unlimited profiles", "Elite AI content", "White-label portal", "Dedicated support"] },
  { id: "premium", name: "Premium", price: "$299/mo", features: ["Unlimited everything", "Unlimited AI tokens", "Link building & outreach", "Quarterly strategy sessions", "24/7 priority support"] },
];

export default function RegisterPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const preselectedPlan = searchParams.get("plan") ?? "starter";

  const [step, setStep] = useState<"form" | "success">("form");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [planId, setPlanId] = useState(preselectedPlan);
  const [feedback, setFeedback] = useState<{ type: string; message: string } | null>(null);
  const [isPending, startTransition] = useTransition();

  const handleRegister = () => {
    if (!email || !password || !companyName) {
      setFeedback({ type: "error", message: "All fields are required." });
      return;
    }
    if (password.length < 8) {
      setFeedback({ type: "error", message: "Password must be at least 8 characters." });
      return;
    }

    startTransition(async () => {
      try {
        // Send everything to server — handles user creation, tenant, workspace, license all at once
        const res = await fetch("/api/register", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email,
            password,
            companyName,
            planId,
          }),
        });

        if (!res.ok) {
          const err = await res.json();
          setFeedback({ type: "error", message: err.error ?? "Registration failed." });
          return;
        }

        setStep("success");
      } catch (err: any) {
        setFeedback({ type: "error", message: err?.message ?? "Unexpected error" });
      }
    });
  };

  if (step === "success") {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <Card className="w-full max-w-md text-center">
          <CardContent className="pt-12 pb-8 space-y-4">
            <div className="mx-auto w-16 h-16 rounded-full bg-green-100 flex items-center justify-center">
              <Check className="size-8 text-green-600" />
            </div>
            <h2 className="text-2xl font-bold">Check your email</h2>
            <p className="text-muted-foreground">
              We sent a confirmation link to your inbox. Click it to verify your email, then
              sign in to start using Agency OS.
            </p>
            <Link href="/login"><Button className="mt-4">Go to Sign In</Button></Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-muted/30">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center">
          <Link href="/" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-4"><ArrowLeft className="size-3" /> Back to home</Link>
          <h1 className="text-3xl font-bold">Create Your Account</h1>
          <p className="text-muted-foreground mt-1">Start your 14-day free trial. No credit card required.</p>
        </div>

        {feedback && (
          <div className={`p-3 rounded-md text-sm ${feedback.type === "success" ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"} border`} role="alert">
            {feedback.message}
            <button className="ml-3 underline text-xs" onClick={() => setFeedback(null)}>Dismiss</button>
          </div>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Account Details</CardTitle>
            <CardDescription>Fill in your details to get started.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="company">Company / Agency Name</Label>
              <Input id="company" placeholder="My Digital Agency" value={companyName} onChange={(e) => setCompanyName(e.target.value)} disabled={isPending} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">Work Email</Label>
              <Input id="email" type="email" placeholder="you@agency.com" value={email} onChange={(e) => setEmail(e.target.value)} disabled={isPending} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input id="password" type="password" placeholder="Min 8 characters" value={password} onChange={(e) => setPassword(e.target.value)} disabled={isPending} />
            </div>
            <div className="space-y-2">
              <Label>Select Plan</Label>
              <Select value={planId} onValueChange={setPlanId}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PLANS.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name} — {p.price}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="mt-2 p-3 rounded-md bg-muted/50">
                <p className="text-xs font-medium mb-1">Includes:</p>
                <ul className="text-xs text-muted-foreground space-y-0.5">
                  {PLANS.find((p) => p.id === planId)?.features.map((f) => (
                    <li key={f} className="flex items-center gap-1"><Check className="size-3 text-green-500" />{f}</li>
                  ))}
                </ul>
              </div>
            </div>
          </CardContent>
          <CardFooter>
            <Button className="w-full" onClick={handleRegister} disabled={isPending}>
              {isPending ? <><Loader2 className="size-4 animate-spin mr-2" /> Creating Account...</> : "Start Free Trial"}
            </Button>
          </CardFooter>
        </Card>

        <p className="text-xs text-center text-muted-foreground">
          Already have an account? <Link href="/login" className="text-primary underline">Sign in</Link>
        </p>
      </div>
    </div>
  );
}