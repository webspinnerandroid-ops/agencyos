// Pure utility functions — no server-side APIs, safe for client and server import

export interface BrandProfile {
  id: string;
  workspace_id: string;
  tenant_id: string;
  name: string;
  is_default: boolean;
  brand_voice: string | null;
  tone_of_voice: string | null;
  persona_description: string | null;
  avoid_words: string[];
  prefer_words: string[];
  min_word_count: number;
  max_word_count: number;
  target_keyword_density: number;
  keyword_discovery_rules: string | null;
  heading_style: string;
  paragraph_structure: string | null;
  required_sections: string[];
  formatting_instructions: string | null;
  meta_description_length: number;
  slug_format: string;
  internal_linking_rules: string | null;
  image_alt_text_rules: string | null;
  platform_overrides: Record<string, any>;
  custom_instructions: string | null;
  created_at: string;
  updated_at: string;
}

export function buildBrandSystemPrompt(profile: BrandProfile, platform?: string): string {
  const lines: string[] = [];
  lines.push("\n--- BRAND GUIDELINES ---\n");
  if (profile.brand_voice) lines.push(`BRAND VOICE: ${profile.brand_voice}`);
  if (profile.tone_of_voice) lines.push(`TONE OF VOICE: ${profile.tone_of_voice}`);
  if (profile.persona_description) lines.push(`PERSONA: ${profile.persona_description}`);
  if (profile.avoid_words.length > 0) lines.push(`AVOID these words/phrases: ${profile.avoid_words.join(", ")}`);
  if (profile.prefer_words.length > 0) lines.push(`PREFER these words/phrases: ${profile.prefer_words.join(", ")}`);
  lines.push(`\nCONTENT RULES:`);
  lines.push(`- Word count: ${profile.min_word_count}–${profile.max_word_count} words`);
  if (profile.target_keyword_density != null) lines.push(`- Target keyword density: ${profile.target_keyword_density}%`);
  if (profile.keyword_discovery_rules) lines.push(`- Keyword discovery: ${profile.keyword_discovery_rules}`);
  if (profile.required_sections.length > 0) lines.push(`- Required sections: ${profile.required_sections.join(", ")}`);
  lines.push(`\nFORMATTING RULES:`);
  lines.push(`- Heading style: ${profile.heading_style}`);
  if (profile.paragraph_structure) lines.push(`- Paragraphs: ${profile.paragraph_structure}`);
  if (profile.formatting_instructions) lines.push(`- ${profile.formatting_instructions}`);
  lines.push(`\nSEO RULES:`);
  lines.push(`- Meta description: max ${profile.meta_description_length} characters`);
  lines.push(`- URL slug format: ${profile.slug_format}`);
  if (profile.internal_linking_rules) lines.push(`- Internal linking: ${profile.internal_linking_rules}`);
  if (profile.image_alt_text_rules) lines.push(`- Image alt text: ${profile.image_alt_text_rules}`);
  if (platform && profile.platform_overrides?.[platform]) {
    const overrides = profile.platform_overrides[platform];
    lines.push(`\nPLATFORM-SPECIFIC RULES (${platform.toUpperCase()}):`);
    for (const [key, value] of Object.entries(overrides)) {
      lines.push(`- ${key}: ${value}`);
    }
  }
  if (profile.custom_instructions) {
    lines.push(`\nCUSTOM INSTRUCTIONS:\n${profile.custom_instructions}`);
  }
  return lines.join("\n");
}

export const BRAND_PRESETS = [
  { id: "blog_agency", name: "Blog Agency Style", brand_voice: "Professional yet approachable", tone_of_voice: "Educational, enthusiastic, conversational", persona_description: "A knowledgeable industry expert who explains complex topics clearly and engagingly.", min_word_count: 800, max_word_count: 2000, target_keyword_density: 1.5, heading_style: "title_case", paragraph_structure: "Short paragraphs (2-3 sentences). Use subheadings every 200-300 words.", required_sections: ["introduction", "body", "conclusion", "call-to-action"] },
  { id: "corporate", name: "Corporate / B2B Style", brand_voice: "Authoritative, polished, trusted", tone_of_voice: "Formal, precise, confident", persona_description: "A seasoned industry leader who communicates with authority and precision.", min_word_count: 500, max_word_count: 1500, target_keyword_density: 1.0, heading_style: "title_case", paragraph_structure: "Structured paragraphs with clear topic sentences. Use data and citations.", required_sections: ["executive_summary", "analysis", "recommendations"] },
  { id: "creative", name: "Creative Agency Style", brand_voice: "Bold, distinctive, memorable", tone_of_voice: "Playful, inspiring, unexpected", persona_description: "A creative visionary who breaks conventions and inspires through bold ideas.", min_word_count: 300, max_word_count: 1200, target_keyword_density: 1.0, heading_style: "sentence_case", paragraph_structure: "Dynamic rhythm — mix short punchy lines with longer narrative paragraphs.", required_sections: ["hook", "story", "insight", "call-to-action"] },
  { id: "ecommerce", name: "E-commerce Style", brand_voice: "Benefit-driven, urgent, persuasive", tone_of_voice: "Friendly, enthusiastic, direct", persona_description: "A friendly shopping advisor who highlights benefits and creates urgency.", min_word_count: 200, max_word_count: 800, target_keyword_density: 2.0, heading_style: "title_case", paragraph_structure: "Scan-friendly — bullet points, bold highlights, short paragraphs.", required_sections: ["hook", "features", "benefits", "social_proof", "call-to-action"] },
  { id: "technical", name: "Technical / SaaS Style", brand_voice: "Precise, thorough, innovative", tone_of_voice: "Neutral, instructional, forward-looking", persona_description: "A technical authority who communicates complex concepts with clarity and depth.", min_word_count: 1000, max_word_count: 3000, target_keyword_density: 1.0, heading_style: "sentence_case", paragraph_structure: "Logical flow — problem statement, technical explanation, solution, examples.", required_sections: ["problem", "solution", "technical_details", "implementation", "faq"] },
] as const;

export type PresetId = (typeof BRAND_PRESETS)[number]["id"];

export function getPreset(presetId: string) {
  return BRAND_PRESETS.find((p) => p.id === presetId);
}