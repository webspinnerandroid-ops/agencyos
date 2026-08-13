"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Loader2,
  CheckCircle2,
  PenLine,
  Eraser,
  FileText,
} from "lucide-react";
import { SIGNING_TERMS } from "@/lib/signing-terms";

interface ProposalData {
  title: string;
  tierName: string;
  price: number | null;
  url: string;
  location: string | null;
  executiveSummary: string;
  targetKeywords: {
    keyword: string;
    searchVolume: number;
    difficulty: string;
    intent: string;
  }[];
  deliverables: string[];
  contentCalendar: {
    month: number;
    focusArea: string;
    contentPieces?: { type: string; title: string }[];
  }[];
}

interface SignState {
  status: string;
  signerName: string;
  signerEmail: string;
  signedAt: string | null;
  signedDocumentUrl: string | null;
  proposal: ProposalData | null;
}

export default function SignPage() {
  const { token } = useParams<{ token: string }>();
  const [state, setState] = useState<SignState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Signature form state
  const [mode, setMode] = useState<"typed" | "drawn">("typed");
  const [fullName, setFullName] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState<{
    signedDocumentUrl: string | null;
    alreadySigned: boolean;
  } | null>(null);
  const [hasDrawn, setHasDrawn] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawing = useRef(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/sign/${token}`);
        const data = await res.json();
        if (!res.ok) {
          setError(data.error ?? "Could not load this signing request.");
          return;
        }
        setState(data as SignState);
        setFullName(data.signerName ?? "");
        if (data.status === "signed") {
          setDone({ signedDocumentUrl: data.signedDocumentUrl, alreadySigned: true });
        }
      } catch {
        setError("Could not load this signing request. Please try again.");
      } finally {
        setLoading(false);
      }
    })();
  }, [token]);

  // Draw handlers
  const getPoint = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    };
  };

  const startDraw = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    const pt = getPoint(e);
    if (!canvas || !pt) return;
    drawing.current = true;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.beginPath();
    ctx.moveTo(pt.x, pt.y);
    ctx.lineWidth = 2.5;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#111";
    canvas.setPointerCapture(e.pointerId);
  };

  const moveDraw = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    const canvas = canvasRef.current;
    const pt = getPoint(e);
    if (!canvas || !pt) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.lineTo(pt.x, pt.y);
    ctx.stroke();
  };

  const endDraw = () => {
    if (drawing.current) {
      drawing.current = false;
      const canvas = canvasRef.current;
      if (canvas) {
        const ctx = canvas.getContext("2d");
        const data = ctx?.getImageData(0, 0, canvas.width, canvas.height).data;
        setHasDrawn(Boolean(data && data.some((v) => v !== 0)));
      }
    }
  };

  const clearCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setHasDrawn(false);
  };

  const submit = useCallback(async () => {
    if (!fullName.trim()) {
      setError("Please enter your full legal name to sign.");
      return;
    }
    if (!agreed) {
      setError("Please check the box to agree to the terms before signing.");
      return;
    }
    if (mode === "drawn") {
      const canvas = canvasRef.current;
      if (!canvas || !hasDrawn) {
        setError("Please draw your signature above before submitting.");
        return;
      }
    }

    setSubmitting(true);
    setError(null);
    try {
      let signatureDataUrl: string | null = null;
      if (mode === "drawn" && canvasRef.current) {
        signatureDataUrl = canvasRef.current.toDataURL("image/png");
      }
      const res = await fetch(`/api/sign/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          signerName: fullName.trim(),
          signatureType: mode,
          signatureDataUrl,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Failed to submit your signature.");
        return;
      }
      setDone({
        signedDocumentUrl: data.signedDocumentUrl ?? null,
        alreadySigned: data.alreadySigned ?? false,
      });
    } catch {
      setError("Network error while submitting your signature. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }, [fullName, agreed, mode, hasDrawn, token]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center space-y-4">
          <div className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full mx-auto" />
          <p className="text-muted-foreground">Loading your proposal...</p>
        </div>
      </div>
    );
  }

  if (error && !state) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Card className="p-8 max-w-md text-center">
          <FileText className="size-10 mx-auto mb-3 text-muted-foreground opacity-40" />
          <h1 className="text-xl font-bold mb-2">Signing link unavailable</h1>
          <p className="text-sm text-muted-foreground">{error}</p>
          <p className="text-xs text-muted-foreground mt-4">
            Need help? Contact your agency and they can send a fresh link.
          </p>
        </Card>
      </div>
    );
  }

  const proposal = state?.proposal;

  if (done) {
    return (
      <div className="min-h-screen bg-background p-4 md:p-8">
        <div className="max-w-xl mx-auto">
          <Card className="p-8 text-center">
            <CheckCircle2 className="size-12 mx-auto mb-4 text-green-600" />
            <h1 className="text-2xl font-bold mb-2">
              {done.alreadySigned ? "Already signed" : "Signature submitted"}
            </h1>
            <p className="text-sm text-muted-foreground mb-6">
              {done.alreadySigned
                ? "This proposal was already signed on this link."
                : "Thank you — your signed agreement is stored in your workspace. Your campaign setup begins automatically."}
            </p>
            <div className="flex flex-col items-center gap-3">
              {done.signedDocumentUrl && (
                <Button
                  variant="outline"
                  onClick={() => window.open(done.signedDocumentUrl!, "_blank")}
                >
                  View Signed Agreement
                </Button>
              )}
              <a
                href={`/seo/proposal?clientId=${state?.proposal ? "" : ""}`}
                className="text-sm text-primary hover:underline"
              >
                Back to all proposals
              </a>
            </div>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background p-4 md:p-8">
      <div className="max-w-2xl mx-auto space-y-6">
        <div className="text-center">
          <h1 className="text-3xl font-bold tracking-tight">
            {proposal?.tierName ?? "Proposal"} — Review &amp; Sign
          </h1>
          <p className="text-muted-foreground mt-2">
            {proposal?.url ? (
              <>
                For: <strong>{proposal.url}</strong>
                {proposal.location ? ` · ${proposal.location}` : ""}
              </>
            ) : (
              "Your proposal is ready to review."
            )}
          </p>
        </div>

        {error && (
          <div className="p-3 rounded-md bg-red-50 text-red-700 border border-red-200 text-sm">
            {error}
          </div>
        )}

        {/* Proposal summary */}
        <Card className="p-6">
          <h2 className="text-lg font-semibold mb-2">Proposal Summary</h2>
          <div className="flex items-baseline gap-2 mb-3">
            {proposal?.price == null ? (
              <span className="text-2xl font-bold text-primary">Custom Consult</span>
            ) : (
              <>
                <span className="text-3xl font-bold text-primary">
                  ${proposal.price.toLocaleString()}
                </span>
                <span className="text-muted-foreground">/month</span>
              </>
            )}
          </div>
          <p className="text-sm text-muted-foreground">{proposal?.executiveSummary}</p>

          {(proposal?.deliverables?.length ?? 0) > 0 && (
            <div className="mt-4">
              <h3 className="text-sm font-semibold mb-1">What's included</h3>
              <ul className="text-sm text-muted-foreground list-disc pl-5 space-y-0.5">
                {proposal!.deliverables.map((d, i) => (
                  <li key={i}>{d}</li>
                ))}
              </ul>
            </div>
          )}

          {(proposal?.contentCalendar?.length ?? 0) > 0 && (
            <div className="mt-4">
              <h3 className="text-sm font-semibold mb-1">Proposed plan</h3>
              <ul className="text-sm text-muted-foreground list-disc pl-5 space-y-0.5">
                {proposal!.contentCalendar.map((m) => (
                  <li key={m.month}>
                    Month {m.month}: {m.focusArea} (
                    {m.contentPieces?.length ?? 0} pieces)
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Card>

        {/* Terms */}
        <Card className="p-6">
          <h2 className="text-lg font-semibold mb-3">Terms of Service</h2>
          <ol className="text-xs text-muted-foreground space-y-2 list-decimal pl-5">
            {SIGNING_TERMS.map((t) => (
              <li key={t.heading}>
                <strong className="text-foreground">{t.heading}.</strong> {t.body}
              </li>
            ))}
          </ol>
        </Card>

        {/* Signature */}
        <Card className="p-6">
          <h2 className="text-lg font-semibold mb-4">Your Signature</h2>

          <div className="flex items-center gap-2 mb-4">
            <Button
              type="button"
              variant={mode === "typed" ? "default" : "outline"}
              size="sm"
              onClick={() => setMode("typed")}
            >
              Type name
            </Button>
            <Button
              type="button"
              variant={mode === "drawn" ? "default" : "outline"}
              size="sm"
              onClick={() => setMode("drawn")}
            >
              <PenLine className="size-3.5 mr-1" /> Draw signature
            </Button>
          </div>

          {mode === "typed" ? (
            <input
              type="text"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="Type your full legal name"
              className="w-full rounded-md border border-input bg-background px-3 py-2.5 text-sm"
            />
          ) : (
            <div className="space-y-2">
              <div className="relative rounded-lg border-2 border-dashed p-1 bg-muted/30">
                <canvas
                  ref={canvasRef}
                  width={700}
                  height={200}
                  className="w-full h-40 touch-none cursor-crosshair rounded"
                  onPointerDown={startDraw}
                  onPointerMove={moveDraw}
                  onPointerUp={endDraw}
                  onPointerLeave={endDraw}
                />
                {!hasDrawn && (
                  <span className="absolute inset-0 flex items-center justify-center text-muted-foreground text-sm pointer-events-none">
                    Sign here with your mouse or finger
                  </span>
                )}
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={clearCanvas}
                className="text-muted-foreground"
              >
                <Eraser className="size-3.5 mr-1" /> Clear
              </Button>
              <input
                type="text"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="Also type your full legal name"
                className="w-full rounded-md border border-input bg-background px-3 py-2.5 text-sm"
              />
            </div>
          )}

          <label className="flex items-start gap-2 mt-5 text-sm text-muted-foreground cursor-pointer">
            <input
              type="checkbox"
              checked={agreed}
              onChange={(e) => setAgreed(e.target.checked)}
              className="mt-0.5"
            />
            <span>
              I have read and agree to the proposal and the Terms of Service
              above. I authorize {state?.signerEmail ? `${state.signerEmail} ` : ""}to
              begin the campaign described, including the 60-day cancellation
              notice period.
            </span>
          </label>

          <Button className="w-full mt-4" onClick={submit} disabled={submitting}>
            {submitting ? (
              <>
                <Loader2 className="size-4 animate-spin mr-2" />
                Submitting signature…
              </>
            ) : (
              <>
                <CheckCircle2 className="size-4 mr-2" />
                Sign &amp; Approve Proposal
              </>
            )}
          </Button>
          <p className="text-xs text-muted-foreground mt-3 text-center">
            Your signature is captured securely, and a signed copy of this
            agreement is stored in your agency's system for your records.
          </p>
        </Card>
      </div>
    </div>
  );
}
