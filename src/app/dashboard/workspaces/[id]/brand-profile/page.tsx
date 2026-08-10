"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { useParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Loader2, ArrowLeft, Save, Sparkles, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { getBrandProfiles, saveBrandProfile, createBrandProfile, deleteBrandProfile, getDefaultBrandProfile, type BrandProfile } from "@/lib/brand-profile";
import { getPreset } from "@/lib/brand-profile-utils";

const HEADING_STYLES = [
  { value: "sentence_case", label: "Sentence case" },
  { value: "title_case", label: "Title Case" },
  { value: "lower_case", label: "lowercase" },
];

const SLUG_FORMATS = [
  { value: "hyphenated", label: "hyphenated-slug-format" },
  { value: "sentence", label: "sentence slug format" },
  { value: "custom", label: "Custom" },
];

export default function BrandProfilePage() {
  const params = useParams();
  const workspaceId = params.id as string;

  const [profiles, setProfiles] = useState<BrandProfile[]>([]);
  const [activeProfile, setActiveProfile] = useState<BrandProfile | null>(null);
  const [feedback, setFeedback] = useState<{ type: string; message: string } | null>(null);
  const [isLoading, startLoading] = useTransition();
  const [isPending, startTransition] = useTransition();

  // Form state
  const [name, setName] = useState("");
  const [brandVoice, setBrandVoice] = useState("");
  const [toneOfVoice, setToneOfVoice] = useState("");
  const [persona, setPersona] = useState("");
  const [avoidWordsStr, setAvoidWordsStr] = useState("");
  const [preferWordsStr, setPreferWordsStr] = useState("");
  const [minWords, setMinWords] = useState(300);
  const [maxWords, setMaxWords] = useState(2500);
  const [keywordDensity, setKeywordDensity] = useState(1.5);
  const [keywordRules, setKeywordRules] = useState("");
  const [headingStyle, setHeadingStyle] = useState("sentence_case");
  const [paragraphStructure, setParagraphStructure] = useState("");
  const [requiredSectionsStr, setRequiredSectionsStr] = useState("");
  const [formatting, setFormatting] = useState("");
  const [metaLength, setMetaLength] = useState(160);
  const [slugFormat, setSlugFormat] = useState("hyphenated");
  const [internalLinking, setInternalLinking] = useState("");
  const [imageAlt, setImageAlt] = useState("");
  const [instagramOverride, setInstagramOverride] = useState("");
  const [linkedinOverride, setLinkedinOverride] = useState("");
  const [customInstructions, setCustomInstructions] = useState("");

  const selectProfile = useCallback((profile: BrandProfile) => {
    setActiveProfile(profile);
    setName(profile.name);
    setBrandVoice(profile.brand_voice ?? "");
    setToneOfVoice(profile.tone_of_voice ?? "");
    setPersona(profile.persona_description ?? "");
    setAvoidWordsStr(profile.avoid_words?.join(", ") ?? "");
    setPreferWordsStr(profile.prefer_words?.join(", ") ?? "");
    setMinWords(profile.min_word_count);
    setMaxWords(profile.max_word_count);
    setKeywordDensity(profile.target_keyword_density);
    setKeywordRules(profile.keyword_discovery_rules ?? "");
    setHeadingStyle(profile.heading_style);
    setParagraphStructure(profile.paragraph_structure ?? "");
    setRequiredSectionsStr(profile.required_sections?.join(", ") ?? "");
    setFormatting(profile.formatting_instructions ?? "");
    setMetaLength(profile.meta_description_length);
    setSlugFormat(profile.slug_format);
    setInternalLinking(profile.internal_linking_rules ?? "");
    setImageAlt(profile.image_alt_text_rules ?? "");
    setInstagramOverride(profile.platform_overrides?.instagram ?? "");
    setLinkedinOverride(profile.platform_overrides?.linkedin ?? "");
    setCustomInstructions(profile.custom_instructions ?? "");
  }, []);

  const load = useCallback(() => {
    startLoading(async () => {
      const res = await getBrandProfiles();
      if (res.success && res.data) {
        setProfiles(res.data);
        const def = res.data.find((p) => p.is_default) ?? res.data[0];
        if (def) selectProfile(def);
      }
    });
  }, [selectProfile]);

  useEffect(() => { load(); }, [load]);

  const handleSave = () => {
    if (!activeProfile) return;
    startTransition(async () => {
      const avoidWords = avoidWordsStr.split(",").map((w) => w.trim()).filter(Boolean);
      const preferWords = preferWordsStr.split(",").map((w) => w.trim()).filter(Boolean);
      const requiredSections = requiredSectionsStr.split(",").map((s) => s.trim()).filter(Boolean);
      const platformOverrides: Record<string, string> = {};
      if (instagramOverride.trim()) platformOverrides.instagram = instagramOverride.trim();
      if (linkedinOverride.trim()) platformOverrides.linkedin = linkedinOverride.trim();

      const res = await saveBrandProfile(activeProfile.id, {
        name,
        brand_voice: brandVoice || null,
        tone_of_voice: toneOfVoice || null,
        persona_description: persona || null,
        avoid_words: avoidWords,
        prefer_words: preferWords,
        min_word_count: minWords,
        max_word_count: maxWords,
        target_keyword_density: keywordDensity,
        keyword_discovery_rules: keywordRules || null,
        heading_style: headingStyle,
        paragraph_structure: paragraphStructure || null,
        required_sections: requiredSections,
        formatting_instructions: formatting || null,
        meta_description_length: metaLength,
        slug_format: slugFormat,
        internal_linking_rules: internalLinking || null,
        image_alt_text_rules: imageAlt || null,
        platform_overrides: platformOverrides,
        custom_instructions: customInstructions || null,
      } as any);

      if (res.success) { setFeedback({ type: "success", message: "Brand profile saved." }); load(); }
      else setFeedback({ type: "error", message: res.error ?? "Save failed." });
    });
  };

  const applyPreset = (presetId: string) => {
    const preset = getPreset(presetId);
    if (!preset) return;
    setBrandVoice(preset.brand_voice ?? "");
    setToneOfVoice(preset.tone_of_voice ?? "");
    setPersona(preset.persona_description ?? "");
    setMinWords(preset.min_word_count ?? 300);
    setMaxWords(preset.max_word_count ?? 2500);
    if (preset.heading_style) setHeadingStyle(preset.heading_style);
    if (preset.paragraph_structure) setParagraphStructure(preset.paragraph_structure);
    if (preset.required_sections) setRequiredSectionsStr(preset.required_sections.join(", "));
    if (preset.target_keyword_density) setKeywordDensity(preset.target_keyword_density);
    setFeedback({ type: "success", message: `Applied ${preset.name} template.` });
  };

  if (isLoading && !activeProfile) return <div className="flex justify-center py-20"><Loader2 className="size-8 animate-spin" /></div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Link href="/dashboard/workspaces"><Button variant="ghost" size="sm"><ArrowLeft className="size-4" /></Button></Link>
          <h1 className="text-2xl font-bold tracking-tight">Brand Profile</h1>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={handleSave} disabled={isPending}><Save className="size-3 mr-1" /> Save</Button>
        </div>
      </div>

      {feedback && (
        <div className={`p-3 rounded-md text-sm ${feedback.type === "success" ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"} border`} role="alert">
          {feedback.message}<button className="ml-3 underline text-xs" onClick={() => setFeedback(null)}>Dismiss</button>
        </div>
      )}

      {/* Preset templates */}
      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><Sparkles className="size-4 text-primary" /> Quick Templates</CardTitle><CardDescription>Apply a preset to get started, then customize.</CardDescription></CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            {["blog_agency", "corporate", "creative", "ecommerce", "technical"].map((pid) => {
              const preset = getPreset(pid);
              return <Button key={pid} variant="outline" size="sm" onClick={() => applyPreset(pid)} disabled={isPending}>{preset?.name ?? pid}</Button>;
            })}
          </div>
        </CardContent>
      </Card>

      {activeProfile && (
        <>
          {/* Voice & Persona */}
          <Card>
            <CardHeader><CardTitle>Voice & Persona</CardTitle><CardDescription>Define how your brand sounds and communicates.</CardDescription></CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2"><Label>Brand Voice</Label><Input value={brandVoice} onChange={e => setBrandVoice(e.target.value)} placeholder="Professional yet approachable" disabled={isPending} /></div>
              <div className="space-y-2"><Label>Tone of Voice</Label><Input value={toneOfVoice} onChange={e => setToneOfVoice(e.target.value)} placeholder="Educational, enthusiastic, conversational" disabled={isPending} /></div>
              <div className="space-y-2"><Label>Persona Description</Label><textarea className="flex min-h-[60px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={persona} onChange={e => setPersona(e.target.value)} placeholder="A knowledgeable industry expert who..." rows={3} disabled={isPending} /></div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2"><Label>Avoid Words (comma-separated)</Label><Input value={avoidWordsStr} onChange={e => setAvoidWordsStr(e.target.value)} placeholder="amazing, revolutionary, game-changer" disabled={isPending} /></div>
                <div className="space-y-2"><Label>Preferred Words (comma-separated)</Label><Input value={preferWordsStr} onChange={e => setPreferWordsStr(e.target.value)} placeholder="effective, proven, innovative" disabled={isPending} /></div>
              </div>
            </CardContent>
          </Card>

          {/* Content Rules */}
          <Card>
            <CardHeader><CardTitle>Content Rules</CardTitle><CardDescription>Length, keyword, and structure requirements.</CardDescription></CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-2"><Label>Min Words</Label><Input type="number" value={minWords} onChange={e => setMinWords(Number(e.target.value))} disabled={isPending} /></div>
                <div className="space-y-2"><Label>Max Words</Label><Input type="number" value={maxWords} onChange={e => setMaxWords(Number(e.target.value))} disabled={isPending} /></div>
                <div className="space-y-2"><Label>Keyword Density %</Label><Input type="number" step="0.1" value={keywordDensity} onChange={e => setKeywordDensity(Number(e.target.value))} disabled={isPending} /></div>
              </div>
              <div className="space-y-2"><Label>Keyword Discovery Rules</Label><Input value={keywordRules} onChange={e => setKeywordRules(e.target.value)} placeholder="Use semantically related LSI keywords, include long-tail variations" disabled={isPending} /></div>
              <div className="space-y-2"><Label>Required Sections (comma-separated)</Label><Input value={requiredSectionsStr} onChange={e => setRequiredSectionsStr(e.target.value)} placeholder="introduction, body, conclusion, call-to-action" disabled={isPending} /></div>
            </CardContent>
          </Card>

          {/* Formatting */}
          <Card>
            <CardHeader><CardTitle>Formatting Rules</CardTitle><CardDescription>Visual structure of generated content.</CardDescription></CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2"><Label>Heading Style</Label><Select value={headingStyle} onValueChange={setHeadingStyle}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{HEADING_STYLES.map(h => <SelectItem key={h.value} value={h.value}>{h.label}</SelectItem>)}</SelectContent></Select></div>
                <div className="space-y-2"><Label>Slug Format</Label><Select value={slugFormat} onValueChange={setSlugFormat}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{SLUG_FORMATS.map(s => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}</SelectContent></Select></div>
              </div>
              <div className="space-y-2"><Label>Paragraph Structure</Label><Input value={paragraphStructure} onChange={e => setParagraphStructure(e.target.value)} placeholder="Short paragraphs, 2-3 sentences max" disabled={isPending} /></div>
              <div className="space-y-2"><Label>Formatting Instructions</Label><textarea className="flex min-h-[60px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={formatting} onChange={e => setFormatting(e.target.value)} placeholder="Use bullet points for lists, bold key terms..." rows={3} disabled={isPending} /></div>
            </CardContent>
          </Card>

          {/* SEO Rules */}
          <Card>
            <CardHeader><CardTitle>SEO Rules</CardTitle><CardDescription>Search optimization parameters.</CardDescription></CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2"><Label>Meta Description Max Length</Label><Input type="number" value={metaLength} onChange={e => setMetaLength(Number(e.target.value))} disabled={isPending} /></div>
              <div className="space-y-2"><Label>Internal Linking Rules</Label><Input value={internalLinking} onChange={e => setInternalLinking(e.target.value)} placeholder="Link to 2-3 related blog posts using keyword anchor text" disabled={isPending} /></div>
              <div className="space-y-2"><Label>Image Alt Text Rules</Label><Input value={imageAlt} onChange={e => setImageAlt(e.target.value)} placeholder="Always include primary keyword in alt text" disabled={isPending} /></div>
            </CardContent>
          </Card>

          {/* Platform Overrides */}
          <Card>
            <CardHeader><CardTitle>Platform Overrides</CardTitle><CardDescription>Custom rules for specific social platforms.</CardDescription></CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2"><Label>Instagram Override</Label><Input value={instagramOverride} onChange={e => setInstagramOverride(e.target.value)} placeholder="Max 30 hashtags, casual tone, emoji-heavy" disabled={isPending} /></div>
              <div className="space-y-2"><Label>LinkedIn Override</Label><Input value={linkedinOverride} onChange={e => setLinkedinOverride(e.target.value)} placeholder="Professional tone, no emojis, data-driven" disabled={isPending} /></div>
            </CardContent>
          </Card>

          {/* Custom Instructions */}
          <Card>
            <CardHeader><CardTitle>Custom Instructions</CardTitle><CardDescription>Any additional rules, preferences, or notes not covered by the structured fields. These are appended directly to the AI prompt.</CardDescription></CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Custom Instructions</Label>
                <textarea className="flex min-h-[100px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={customInstructions} onChange={e => setCustomInstructions(e.target.value)} placeholder="Example: Always start blog posts with a statistic. Include a FAQ section at the end. Never use passive voice. Use American English spelling..." rows={5} disabled={isPending} />
              </div>
            </CardContent>
          </Card>
        </>
      )}

      {/* Multiple profiles */}
      {profiles.length > 1 && (
        <Card>
          <CardHeader><CardTitle>Other Profiles</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {profiles.filter(p => p.id !== activeProfile?.id).map(p => (
              <div key={p.id} className="flex items-center justify-between p-2 rounded border">
                <div className="flex items-center gap-2"><Badge variant={p.is_default ? "default" : "outline"}>{p.is_default ? "Default" : ""}</Badge><span>{p.name}</span></div>
                <div className="flex items-center gap-1">
                  <Button variant="ghost" size="sm" onClick={() => selectProfile(p)}>Edit</Button>
                  <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-destructive h-7 w-7" onClick={() => startTransition(async () => { await deleteBrandProfile(p.id); load(); })}><Trash2 className="size-3" /></Button>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}