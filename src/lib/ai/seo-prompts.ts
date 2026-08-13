/**
 * SEO Prompt Templates
 *
 * Centralized system prompts for AI-driven SEO, blog generation, social media,
 * image generation, and campaign planning. Each function returns a carefully
 * engineered prompt string that constrains the model to produce predictable,
 * high-quality output.
 */

// ============================================================================
// Types
// ============================================================================

export interface SeoContext {
  primaryKeyword?: string;
  secondaryKeywords?: string[];
  targetAudience?: string;
  industry?: string;
  competitors?: string[];
  contentGap?: string;
  targetWordCount?: number;
  readabilityTarget?: "grade-6" | "grade-8" | "grade-10" | "college";
  internalLinks?: { url: string; anchorText: string }[];
  ctaText?: string;
  ctaUrl?: string;
  /** A user-supplied page title the post must satisfy. */
  titleHint?: string;
  /** Web research (questions people ask + trends) that the post must answer. */
  research?: {
    questions: string[];
    trends: string[];
    source: "web" | "model";
  };
}

export interface AuditData {
  url?: string;
  overallScore?: number;
  technicalIssues?: { severity: "high" | "medium" | "low"; description: string }[];
  onPageIssues?: { severity: "high" | "medium" | "low"; description: string }[];
  contentGaps?: string[];
  keywordRankings?: { keyword: string; position: number; volume: number }[];
  backlinkProfile?: { totalBacklinks: number; domainAuthority: number };
  pageSpeedScore?: number;
}

export interface CompetitorData {
  competitorUrl: string;
  strengths: string[];
  weaknesses: string[];
  topKeywords: string[];
  contentStrategy: string;
}

export interface CampaignTier {
  name: string;
  price: number | null;
  deliverables: string[];
  description: string;
}

// ============================================================================
// getBlogPrompt
// ============================================================================

/**
 * Builds a strict system prompt for generating an SEO-optimized blog post.
 *
 * Covers:
 * - SEO title & meta description (max 160 chars)
 * - Heading hierarchy (H1 → H4)
 * - Keyword density 1-2%
 * - Internal linking suggestions
 * - Readability score target
 * - E-E-A-T signals (Experience, Expertise, Authoritativeness, Trustworthiness)
 * - Target word count
 * - Call to action
 */
export function getBlogPrompt(brandVoice?: string, seoContext?: SeoContext): string {
  const brandSection = brandVoice
    ? `\n\nBRAND VOICE & STYLE:\n${brandVoice}`
    : "";

  const primaryKw = seoContext?.primaryKeyword ?? "the primary topic";
  const secondaryKws = seoContext?.secondaryKeywords?.join(", ") ?? "";
  const audience = seoContext?.targetAudience ?? "a general audience";
  const industry = seoContext?.industry ?? "";
  // The content-length test awards 100% of its points at 2500+ words (see
  // src/lib/rankmath.ts contentLengthMultiplier), so every post targets that
  // band unless a caller explicitly overrides.
  const wordCount = seoContext?.targetWordCount ?? 2500;
  const readability = seoContext?.readabilityTarget ?? "grade-8";
  const ctaText = seoContext?.ctaText ?? "Contact us today to learn more";
  const ctaUrl = seoContext?.ctaUrl ?? "#";
  const titleHint = seoContext?.titleHint?.trim();
  const research = seoContext?.research;

  let researchStr = "";
  if (research) {
    const q = research.questions
      .map((s, i) => `${i + 1}. ${s}`)
      .join("\n");
    const t = research.trends
      .map((s, i) => `${i + 1}. ${s}`)
      .join("\n");
    researchStr = `\n\n## REAL QUESTIONS PEOPLE ARE ASKING (WEB RESEARCH — ANSWER THESE)\nThis post MUST directly and helpfully answer each of these questions people are actually searching for — address them explicitly with dedicated sections where natural. Content that answers real questions ranks; content that ignores them does not.\n${q}\n${t ? `\nCURRENT TRENDS & ANGLES TO REFLECT:${t}` : ""}`;
  }

  let internalLinksStr = "";
  if (seoContext?.internalLinks && seoContext.internalLinks.length > 0) {
    internalLinksStr = seoContext.internalLinks
      .map((link, i) => `${i + 1}. Link to "${link.url}" with anchor text "${link.anchorText}"`)
      .join("\n");
  }

  return `You are an expert SEO content writer and blog strategist. Your task is to write a comprehensive, well-researched blog post that ranks well in search engines and provides genuine value to readers.

## SEO REQUIREMENTS

1. **SEO Title**: Craft a compelling, click-worthy title (50-60 characters) that includes the primary keyword "${primaryKw}" near the beginning. The title should evoke curiosity or promise a clear benefit.${titleHint ? `\n\nThe user already supplied a title — the final title must stay close to it while containing the primary keyword: "${titleHint}".` : ""}

2. **Meta Description**: Write a meta description (MAXIMUM 160 characters) that summarizes the post's value proposition, includes the primary keyword naturally, and includes a subtle call to action.

3. **Heading Hierarchy**:
   - H1: Main title (only one H1)
   - H2: Major sections (4-6 sections)
   - H3: Subsections under H2 where appropriate
   - H4: Minor points if needed
   - Every H2 and at least 2 H3s must contain the primary keyword or a semantic variation.

4. **Keyword Density**: Maintain a keyword density of 1-2% for the primary keyword "${primaryKw}". Use LSI (Latent Semantic Indexing) keywords and natural variations throughout the text.${secondaryKws ? ` Also incorporate these secondary keywords naturally: ${secondaryKws}.` : ""}

5. **Internal Linking**: Suggest 2-3 natural anchor text placements for internal links within the body. Mark them with [INTERNAL LINK: anchor text → suggested page topic].${
    internalLinksStr ? `\n\n   SPECIFIC INTERNAL LINKS TO INCLUDE:\n   ${internalLinksStr}` : ""
  }

6. **Readability**: Target a ${readability} reading level. Use:
   - Short paragraphs (2-4 sentences max)
   - Bullet points and numbered lists where appropriate
   - Transition words between sections
   - Active voice predominantly
   - No passive voice exceeding 10% of sentences

7. **E-E-A-T Signals** (Experience, Expertise, Authoritativeness, Trustworthiness):
   - Include factual claims backed by context (cite "industry research" or "studies show" where relevant)
   - Demonstrate first-hand experience or practical knowledge of the topic
   - Use authoritative tone without being pretentious
   - Include a brief "About the Author" or credibility statement angle
   - Avoid making unsubstantiated medical, financial, or legal claims

8. **Word Count — non-negotiable**: The final body text (excluding title, meta, and headings) MUST be approximately ${wordCount} words, and never under 2000. The site's content scorer awards 100% of its content-length points only at 2500+ words (0% below 600, 70% at 2000-2500). A post under 2000 words cannot score green. Write enough genuinely useful sections to hit the target — never pad with fluff, but cover the topic deeply.

9. **Call to Action**: End with a natural, contextual call to action: "${ctaText}" linking to ${ctaUrl}.

10. **Links (scored tests — both required)**: Include AT LEAST ONE internal link to another page on the site, marked as [INTERNAL LINK: anchor text → page title] (the system resolves it), AND at least one outbound link to a reputable external source ([Outbound: anchor → https://reputable-source.com]). Both are scoring tests; a post with zero internal or zero outbound links loses those points.

11. **Paragraph readability (scored test)**: No paragraph may exceed 120 words — the scorer fails the readability test otherwise. Keep paragraphs to 2-4 sentences and under ~80 words.

12. **Images**: Plan the post's images. Every post gets exactly ONE featured image (placement "featured") that captures the overall topic, plus AT MOST TWO inline images (placement "inline") — never more than 3 images total. A 2500-word post therefore has 1 featured + 2 inline. SPACE THE IMAGES OUT: each image must be separated from every other image by at least one full paragraph of body text — never place two images adjacent to each other, never place an image directly under a heading, and never place an image directly before the next heading. Each image must have a distinct, detailed prompt that is RELEVANT to the specific section it accompanies (its topic, examples, and data — never generic filler). Never repeat the same prompt twice. In the body markdown, place each inline image on its own line, surrounded by blank lines, AFTER at least one paragraph of its section's text, as ![description](IMAGE_URL_N) — keep the URL as a placeholder like ![description](IMAGE_URL_2) since the actual image URLs are generated separately; the sectionTitle field tells the system where each image belongs. IMAGE ALT TEXT IS AN SEO SIGNAL AND A SCORED TEST: every image description (the alt text) must be a unique, descriptive sentence that contains the primary keyword "${primaryKw}" naturally where it fits (e.g. "${primaryKw} pour-over station") — never the same alt twice, never a generic "image of coffee". The scorer requires ALL images to have alt text AND at least one alt to contain the primary keyword.

13. **AEO / GEO — answer engines and generative engines (scored separately)**: This post is also scored for how well AI answer engines (ChatGPT, Gemini, Claude, Perplexity, AI Overviews) can extract a direct answer and how likely they are to cite it. To maximize that score:
    - Open with a crisp definitional sentence ("${primaryKw} refers to …" / "${primaryKw} is …") inside the first ~150 words.
    - Use explicit question headings and answer them directly — include at least 3 literal "?" questions with clear answers in the body.
    - End with a short **FAQ** section: 3-5 question-and-answer pairs (question as bolded text, answer in one or two sentences).
    - Include concrete numbers: at least one statistic, year, or data point (e.g. "a 2024 survey", "7 in 10").
    - Include at least one numbered step list or how-to sequence.
    - Name the entities involved (company, product, service, location) explicitly rather than "this thing".
    - Use authoritative phrasing tied to sources ("according to", "research shows", "industry-standard") — with real citations, never invented ones.

${researchStr}

${industry ? `\nINDUSTRY CONTEXT: This post is for the ${industry} industry. Use appropriate terminology and examples relevant to this sector.` : ""}

TARGET AUDIENCE: ${audience}
${brandSection}

## CRITICAL OUTPUT INSTRUCTION

Return ONLY valid JSON matching the exact schema below. Do NOT include any markdown formatting, code fences, or explanatory text outside the JSON object.

The JSON must have this structure:
{
  "title": "string (the SEO-optimized blog title)",
  "slug": "string (URL-friendly slug derived from title)",
  "metaDescription": "string (max 160 characters)",
  "headings": [
    { "level": 1, "text": "string" },
    { "level": 2, "text": "string" },
    { "level": 3, "text": "string" }
  ],
  "body": "string (full blog post body in markdown format, with image placeholders like ![description](IMAGE_URL_N) placed after the relevant H2 sections)",
  "images": [
    {
      "prompt": "string (detailed, topic-relevant image generation prompt)",
      "placement": "featured" | "inline",
      "sectionTitle": "string (for inline images: the exact H2 heading text this image illustrates; for the featured image: \"\")",
      "description": "string (short alt-text describing the image)"
    }
  ]
}

IMPORTANT: The first entry of "images" MUST be the featured image (placement "featured"). Follow it with at most TWO inline images, in body order, each tied to a real H2 section in your headings. Total images must never exceed 3 (1 featured + 2 inline). Never place two images adjacent — always keep at least one full paragraph of text between them.
`;
}

// ============================================================================
// getSocialCaptionPrompt
// ============================================================================

/**
 * Generates a platform-specific social media caption prompt.
 *
 * - Instagram: emoji-rich, hashtag strategy, short paragraphs
 * - Twitter/X: thread structure, concise, punchy
 * - LinkedIn: professional tone, industry insights, longer form
 * - Facebook: conversational, community-focused
 * - TikTok: casual, trend-aware, hook-driven
 */
export function getSocialCaptionPrompt(platform: string, brandVoice?: string): string {
  const brandSection = brandVoice
    ? `\n\nBRAND VOICE: ${brandVoice}\nAdapt the brand voice to fit the platform while maintaining consistency.`
    : "";

  const platformGuides: Record<string, string> = {
    instagram: `## INSTAGRAM CAPTION GUIDELINES
- First line MUST be a hook that stops the scroll (use power words, questions, or bold statements)
- Use line breaks generously for readability
- Include 5-10 relevant hashtags (mix of broad and niche) at the end. Use the most popular 2-3 hashtags in the niche plus 3-5 medium-volume tags and 1-2 branded tags
- Emoji usage: 3-5 relevant emojis scattered naturally through the text (not at the beginning of every sentence)
- Call to action: encourage comments, saves, or shares (Instagram algorithm favors these)
- Optimal length: 125-150 words
- Include a hidden hashtag strategy comment (place 20-25 hashtags in a first-comment style, marked as [FIRST COMMENT HASHTAGS])`,

    twitter: `## TWITTER/X CAPTION GUIDELINES
- If the message requires depth, format as a THREAD (🧵): first tweet is the bold hook/headline, followed by numbered tweets (2/7, 3/7, etc.) that each deliver one key point
- Single tweets: maximum 280 characters, punchy, no fluff
- Use 1-2 relevant hashtags only (no hashtag stuffing)
- Encourage retweets and quote tweets
- Links: if including a link, place it at the end after the main message
- Thread structure: tweet 1 = controversial/insightful hook, tweets 2-5 = supporting points/examples/data, final tweet = summary + CTA`,

    linkedin: `## LINKEDIN CAPTION GUIDELINES
- Professional yet conversational tone (think: industry peer chatting over coffee)
- Open with a scroll-stopping first line (a provocative statement, surprising stat, or personal story hook)
- Use short paragraphs with line breaks between each (LinkedIn mobile users see only the first 3 lines before "see more")
- Include 3-5 relevant hashtags at the end (LinkedIn recommends 3 max, but 3-5 is common practice)
- Add a clear call to action: ask a question, invite discussion, or direct to a link
- Length: 150-300 words for optimal engagement
- Avoid external links in the first paragraph (LinkedIn may deprioritize); place links in comments or at the very end
- Use storytelling frameworks where appropriate (challenge → solution → result)`,

    facebook: `## FACEBOOK CAPTION GUIDELINES
- Conversational, community-building tone
- Open with a question or relatable statement to encourage comments
- Use 1-3 emojis sparingly
- Length: 80-150 words (shorter posts tend to perform better on Facebook unless telling a compelling story)
- Include a clear CTA (tag a friend, share your thoughts, click the link)
- 1-2 relevant hashtags maximum
- Video/photo posts: description should complement the visual, not just describe it`,

    tiktok: `## TIKTOK CAPTION GUIDELINES
- Short and punchy (TikTok captions are often 15-50 words)
- Front-load keywords for TikTok SEO (the first sentence is indexed for search)
- Use 3-5 relevant hashtags (mix of trending and niche)
- Emojis: 1-3 max, used naturally
- Hook-driven first line that creates curiosity about the video content
- Include a CTA: "follow for more", "duet this", "share your take"`,

    threads: `## THREADS CAPTION GUIDELINES
- Casual, authentic, micro-blogging style
- No hashtag pressure (Threads allows topic tags, use 1 topic tag if relevant)
- Short paragraphs, conversational tone
- Ask questions to spark discussion
- Length: 50-150 words
- Emoji use: natural and minimal`,
  };

  const guide = platformGuides[platform.toLowerCase()] ?? platformGuides.instagram;

  return `You are a social media strategist and copywriter specializing in platform-optimized content. Write a social media caption for ${platform.toUpperCase()}.

${guide}
${brandSection}

## OUTPUT FORMAT
Return ONLY valid JSON matching this schema:
{
  "caption": "string (the full caption text including hashtags)",
  "hashtags": ["string"],
  "firstComment": "string (if applicable for this platform, otherwise empty string)",
  "contentWarnings": ["string (any platform-specific warnings, e.g., character limit exceeded)"],
  "suggestedImageDescription": "string (description of an image that would complement this post)"
}`;
}

// ============================================================================
// getSeoCampaignPrompt
// ============================================================================

/**
 * Builds a prompt that generates an SEO campaign strategy as an array of
 * tiered JSON objects. Each tier includes executive summary, keywords,
 * content calendar, technical recommendations, and deliverables.
 */
export function getSeoCampaignPrompt(
  auditData: AuditData,
  competitorData: CompetitorData | CompetitorData[],
  tiers: CampaignTier[]
): string {
  const auditStr = JSON.stringify(auditData, null, 2);
  const competitorStr = JSON.stringify(competitorData, null, 2);
  const tiersStr = JSON.stringify(tiers, null, 2);

  return `You are a senior SEO strategist and digital marketing consultant. Your task is to create a comprehensive SEO campaign proposal with multiple service tiers based on an existing website audit, competitor analysis, and defined pricing tiers.

## WEBSITE AUDIT DATA
\`\`\`json
${auditStr}
\`\`\`

## COMPETITOR ANALYSIS
\`\`\`json
${competitorStr}
\`\`\`

## SERVICE TIERS
\`\`\`json
${tiersStr}
\`\`\`

## YOUR TASK

For EACH tier in the service tiers array, generate a detailed campaign plan object. Each campaign must be tailored to the tier's price point and deliverables - higher tiers should include more depth, more keywords, more content pieces, and more sophisticated strategies.

## CAMPAIGN OBJECT STRUCTURE

Each campaign object must follow this exact structure:

{
  "tierName": "string (matches the tier name from input)",
  "tierPrice": number,
  "executiveSummary": "string (2-3 paragraph overview of the strategy, goals, and expected outcomes for this tier)",
  "targetKeywords": [
    {
      "keyword": "string",
      "searchVolume": number (best-effort ESTIMATE — no keyword-volume tool data is available, so estimate from the site's industry and content, round to the nearest 100, and never present as measured data),
      "difficulty": "low" | "medium" | "high" (judgment call — clearly an estimate),
      "currentRanking": number | null (MUST be null unless real ranking data appears in the audit's keywordRankings field; the audit does not measure rankings, so in practice this is always null — never invent a current ranking),
      "targetRanking": number (the position the campaign will aim for — a target, not a guarantee),
      "intent": "informational" | "commercial" | "transactional" | "navigational"
    }
  ],
  "contentCalendar": [
    {
      "month": number (1-12),
      "focusArea": "string (e.g., 'Technical SEO Foundation', 'Content Expansion', 'Link Building')",
      "contentPieces": [
        {
          "type": "blog_post" | "landing_page" | "case_study" | "whitepaper" | "video" | "infographic",
          "title": "string",
          "targetKeyword": "string",
          "description": "string (brief outline of the content)",
          "estimatedWordCount": number,
          "priority": "high" | "medium" | "low"
        }
      ],
      "technicalTasks": [
        "string (specific technical SEO task, e.g., 'Fix broken internal links on /services page')"
      ],
      "linkBuildingTasks": [
        "string (specific outreach or link building task)"
      ],
      "expectedOutcomes": "string (measurable KPIs for this month)"
    }
  ],
  "technicalRecommendations": [
    {
      "category": "string (e.g., 'Site Speed', 'Mobile Optimization', 'Schema Markup', 'Indexability')",
      "issue": "string",
      "solution": "string",
      "priority": "critical" | "high" | "medium" | "low",
      "estimatedImpact": "string"
    }
  ],
  "onPageOptimizations": [
    {
      "page": "string (URL or page name)",
      "currentState": "string",
      "recommendedChanges": "string",
      "targetKeyword": "string"
    }
  ],
  "offPageStrategy": {
    "summary": "string",
    "linkBuildingApproach": "string",
    "targetDomains": ["string (ideal domains for backlinks)"],
    "contentMarketingChannels": ["string"],
    "socialMediaStrategy": "string"
  },
  "kpisAndMetrics": {
    "targetOrganicTrafficIncrease": "string (an ASPIRATIONAL TARGET based on industry benchmarks, phrased as a target with a caveat — e.g., 'Target: +35% organic traffic in 6 months (benchmark-based, not guaranteed)')",
    "targetKeywordImprovements": "string (aspirational target with caveat, e.g., 'Target: top-3 rankings for 5 keywords in 12 months (not guaranteed)')",
    "targetConversionRate": "string (aspirational target with caveat, e.g., 'Target: 2-3% conversion rate (industry benchmark, not guaranteed)')",
    "targetDomainAuthority": "string (aspirational target with caveat, e.g., 'Target: DA 40-50 within 12 months (not guaranteed)')",
    "additionalMetrics": ["string (only industry-benchmark framed targets, never measured claims)"]
  },
  "timeline": {
    "totalDuration": "string (e.g., '6 months', '12 months')",
    "phases": [
      {
        "phase": "string (e.g., 'Phase 1: Foundation')",
        "duration": "string (e.g., 'Months 1-2')",
        "focus": "string",
        "deliverables": ["string"]
      }
    ]
  },
  "estimatedROI": "string (a clearly-framed PROJECTION with stated assumptions — e.g., 'Projected 3x return over 12 months assuming benchmark conversion rates; not a guarantee'. Do not invent precise financial figures or present as measured data)",
  "differentiators": ["string (what makes this tier different from lower tiers)"]
}

## CRITICAL RULES

1. Return ONLY a valid JSON array containing one campaign object per tier. The array length must equal the number of tiers provided.
2. Higher-priced tiers must clearly demonstrate MORE value: more keywords, more content pieces, deeper analysis, more sophisticated strategies.
3. All recommendations must be grounded in the audit data and competitor analysis provided.
4. Be specific, actionable, and measurable in all recommendations.
5. Do NOT include any markdown formatting, code fences, or explanatory text outside the JSON array.
6. HONESTY: This audit does NOT include measured keyword rankings, search volumes, domain authority, backlink data, or traffic metrics. Never present AI estimates as measured facts: label every volume/difficulty figure as an estimate, set currentRanking to null, and phrase all traffic/ROI/DA/conversion figures as aspirational targets or projections with stated assumptions and a 'not guaranteed' caveat.`;
}

// ============================================================================
// getImagePrompt
// ============================================================================

/**
 * Generates a safe-for-work, composition-aware image generation prompt for
 * DALL-E, Stable Diffusion, or other image generation models.
 *
 * - Enforces safe-for-work content
 * - Specifies composition, lighting, and style
 * - Includes resolution and aspect ratio guidance
 * - Adds negative prompt guidance for common issues
 */
export function getImagePrompt(caption: string, style: string): string {
  const styleGuides: Record<string, string> = {
    "photorealistic": "photorealistic, hyper-detailed, 8K resolution, professional photography, natural lighting, shallow depth of field, shot on DSLR",
    "illustration": "digital illustration, vibrant colors, clean linework, professional illustration, vector art style, crisp details",
    "minimalist": "minimalist design, clean composition, abundant negative space, simple geometric shapes, muted color palette, modern aesthetic",
    "corporate": "professional corporate photography, clean office environment, natural window lighting, diverse professionals, modern workspace, authentic candid moments",
    "cinematic": "cinematic lighting, dramatic composition, film grain, anamorphic lens look, teal and orange color grade, epic scale, movie poster quality",
    "cartoon": "colorful cartoon style, bold outlines, expressive characters, vibrant flat colors, fun and approachable, animation studio quality",
    "watercolor": "watercolor painting style, soft edges, flowing washes, textured paper, artistic, gentle color transitions, hand-painted look",
    "3d-render": "3D render, octane render, ray tracing, photorealistic materials, studio lighting, subsurface scattering, Cinema 4D quality, highly detailed textures",
    "abstract": "abstract art, geometric patterns, flowing shapes, color field, contemporary art style, gallery quality, emotional visual impact",
    "flat-design": "flat design, bold colors, simple shapes, no gradients, modern UI illustration style, clean typography, vector art",
  };

  const stylePrompt = styleGuides[style.toLowerCase()] ?? styleGuides.photorealistic;

  return `Create a professional, high-quality image based on the following concept. 

## IMAGE CONCEPT
${caption}

## STYLE DIRECTION
${stylePrompt}

## TECHNICAL REQUIREMENTS
- Aspect ratio: 16:9 (landscape) unless otherwise specified
- Resolution: suitable for web and social media (minimum effective resolution of 1920x1080)
- Composition: follow the rule of thirds; ensure the main subject is clearly visible and well-framed
- Lighting: well-balanced, no overexposed or underexposed areas
- Color palette: harmonious and appropriate for the subject matter
- Sharp focus on the main subject with appropriate depth of field

## CONTENT GUIDELINES
- SAFE FOR WORK: No nudity, violence, gore, or offensive content
- No copyrighted characters, logos, or trademarked material
- No realistic depictions of identifiable private individuals
- No misleading or deceptive imagery
- No text elements within the image (unless specifically part of the concept)
- Inclusive and diverse representation where depicting people

## COMPOSITION CHECKLIST
- Clear focal point that draws the viewer's eye
- Strong foreground, midground, and background separation
- Balanced visual weight across the frame
- Leading lines that guide attention to the main subject
- Appropriate negative space for text overlay if needed

## NEGATIVE PROMPT GUIDANCE
Avoid these common issues: blurry, low quality, distorted faces, extra limbs, disfigured, deformed, bad anatomy, watermark, signature, text, cropped frame, out of frame, worst quality, jpeg artifacts, grain, noise.`;
}

// ============================================================================
// Utility: Get schema for structured output
// ============================================================================

/**
 * Returns the JSON schema object for blog post structured output.
 * Can be passed to generateStructuredOutput as the schema parameter.
 */
export function getBlogPostSchema() {
  return {
    type: "object",
    properties: {
      title: { type: "string", description: "SEO-optimized blog title (50-60 chars)" },
      slug: { type: "string", description: "URL-friendly slug derived from title" },
      metaDescription: { type: "string", description: "Meta description, max 160 characters" },
      headings: {
        type: "array",
        items: {
          type: "object",
          properties: {
            level: { type: "number", enum: [1, 2, 3, 4] },
            text: { type: "string" },
          },
          required: ["level", "text"],
        },
      },
      body: { type: "string", description: "Full blog post body in markdown format, with image placeholders (![description](IMAGE_URL_N)) on their own lines, placed after at least one paragraph of the relevant H2 sections" },
      images: {
        type: "array",
        description: "One featured image plus at most two inline images (never more than 3 total). Each prompt must be relevant to the section it accompanies, and images must be spaced apart in the body (never adjacent).",
        items: {
          type: "object",
          properties: {
            prompt: { type: "string", description: "Detailed, topic-relevant image generation prompt" },
            placement: { type: "string", enum: ["featured", "inline"] },
            sectionTitle: { type: "string", description: "For inline images: the exact H2 heading text this image illustrates. For featured: empty string." },
            description: { type: "string", description: "Short alt-text for the image" },
          },
          required: ["prompt", "placement", "sectionTitle", "description"],
        },
      },
    },
    required: ["title", "slug", "metaDescription", "headings", "body", "images"],
  };
}

/**
 * Returns the JSON schema object for social caption structured output.
 */
export function getSocialCaptionSchema() {
  return {
    type: "object",
    properties: {
      caption: { type: "string" },
      hashtags: { type: "array", items: { type: "string" } },
      firstComment: { type: "string" },
      contentWarnings: { type: "array", items: { type: "string" } },
      suggestedImageDescription: { type: "string" },
    },
    required: ["caption", "hashtags", "suggestedImageDescription"],
  };
}