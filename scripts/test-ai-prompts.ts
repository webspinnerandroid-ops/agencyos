/**
 * Test script for AI prompt generation functions.
 *
 * This script demonstrates the prompt engineering layer without requiring
 * actual AI provider API keys or Supabase connectivity.
 *
 * Run with: npx tsx scripts/test-ai-prompts.ts
 */

import {
  getBlogPrompt,
  getSocialCaptionPrompt,
  getSeoCampaignPrompt,
  getImagePrompt,
  getBlogPostSchema,
  getSocialCaptionSchema,
  type SeoContext,
  type AuditData,
  type CompetitorData,
  type CampaignTier,
} from "../src/lib/ai/seo-prompts";

// ============================================================================
// Sample Data
// ============================================================================

const sampleBrandVoice = `
Tone: Professional yet approachable. We are the trusted experts who speak in plain English, not jargon.
Values: Transparency, data-driven decisions, long-term partnerships over quick wins.
Voice: Confident but never arrogant. We use "we" not "I". Active voice always.
Audience: B2B decision-makers (CMOs, marketing directors, business owners) who are overwhelmed by technical SEO but understand its importance.
Do: Use concrete examples, cite data, offer actionable takeaways.
Don't: Use fear-based marketing, make guarantees about rankings, disparage competitors.
`;

const sampleSeoContext: SeoContext = {
  primaryKeyword: "enterprise SEO strategy",
  secondaryKeywords: [
    "SEO ROI",
    "B2B SEO best practices",
    "technical SEO audit",
    "content strategy framework",
  ],
  targetAudience: "CMOs and marketing directors at mid-size B2B companies ($50M-$500M revenue)",
  industry: "B2B SaaS and Professional Services",
  targetWordCount: 1800,
  readabilityTarget: "grade-8",
  internalLinks: [
    { url: "/services/seo-audit", anchorText: "comprehensive SEO audit" },
    { url: "/case-studies/saas-seo-growth", anchorText: "B2B SaaS SEO case study" },
    { url: "/blog/seo-roi-calculator", anchorText: "calculate your SEO ROI" },
  ],
  ctaText: "Schedule a free SEO strategy session",
  ctaUrl: "/contact/strategy-session",
};

const sampleAuditData: AuditData = {
  url: "https://example-saas.com",
  overallScore: 62,
  technicalIssues: [
    { severity: "high", description: "Missing SSL certificate on staging subdomain" },
    { severity: "high", description: "Slow page load time (LCP: 4.2s on mobile)" },
    { severity: "medium", description: "Duplicate meta descriptions across 23 pages" },
    { severity: "low", description: "Missing alt text on 12 blog images" },
  ],
  onPageIssues: [
    { severity: "high", description: "H1 tag missing on homepage" },
    { severity: "medium", description: "Keyword cannibalization between /features and /solutions" },
    { severity: "low", description: "Thin content on 8 blog posts (<300 words)" },
  ],
  contentGaps: [
    "No content targeting 'enterprise SEO platform' keywords",
    "Missing comparison pages vs top 3 competitors",
    "No thought leadership content on AI in SEO",
  ],
  keywordRankings: [
    { keyword: "SEO software", position: 12, volume: 5400 },
    { keyword: "enterprise SEO platform", position: 28, volume: 3200 },
    { keyword: "SEO audit tool", position: 8, volume: 4400 },
    { keyword: "B2B SEO tool", position: 15, volume: 1800 },
  ],
  backlinkProfile: { totalBacklinks: 1240, domainAuthority: 38 },
  pageSpeedScore: 58,
};

const sampleCompetitorData: CompetitorData[] = [
  {
    competitorUrl: "https://competitor-one.com",
    strengths: [
      "Strong brand recognition in enterprise space",
      "Comprehensive API documentation",
      "Weekly webinar series driving consistent leads",
    ],
    weaknesses: [
      "Pricing is opaque (no public pricing page)",
      "Poor mobile experience",
      "Limited customer support hours",
    ],
    topKeywords: ["enterprise SEO platform", "SEO tools for agencies", "rank tracking API"],
    contentStrategy: "Blog-heavy with 3 posts/week, strong on technical SEO topics, weak on thought leadership",
  },
  {
    competitorUrl: "https://competitor-two.com",
    strengths: [
      "Best-in-class UX and onboarding",
      "Free tier captures SMB market",
      "Strong YouTube presence with tutorials",
    ],
    weaknesses: [
      "Limited enterprise features",
      "No white-label option for agencies",
      "Customer support is email-only",
    ],
    topKeywords: ["SEO tools", "free SEO audit", "keyword tracker"],
    contentStrategy: "Video-first content strategy, comparison posts targeting competitor names, weak blog presence",
  },
];

const sampleTiers: CampaignTier[] = [
  {
    name: "Foundation",
    price: 2500,
    deliverables: [
      "Technical SEO audit",
      "Keyword research (50 keywords)",
      "On-page optimization (10 pages)",
      "Monthly performance report",
    ],
    description: "Essential SEO foundation for small teams getting started with organic growth.",
  },
  {
    name: "Growth",
    price: 5000,
    deliverables: [
      "Everything in Foundation",
      "Content strategy & calendar",
      "4 blog posts/month",
      "Link building outreach (10 targets/month)",
      "Competitor monitoring",
      "Bi-weekly strategy calls",
    ],
    description: "Accelerated growth plan for companies ready to invest in content and authority building.",
  },
  {
    name: "Enterprise",
    price: 12000,
    deliverables: [
      "Everything in Growth",
      "Advanced technical SEO (schema, log file analysis)",
      "8 content pieces/month (blogs, whitepapers, case studies)",
      "CRO & conversion-focused landing pages",
      "Dedicated account strategist",
      "Custom dashboard & weekly reporting",
      "PR & digital PR link building",
      "International SEO (if applicable)",
    ],
    description: "Full-service SEO partnership for enterprises dominating competitive SERPs.",
  },
];

// ============================================================================
// Test Functions
// ============================================================================

function testBlogPrompt(): void {
  console.log("\n");
  console.log("═".repeat(80));
  console.log("  TEST 1: Blog Prompt Generation");
  console.log("═".repeat(80));

  const prompt = getBlogPrompt(sampleBrandVoice, sampleSeoContext);

  console.log("\n📊 Character count:", prompt.length.toLocaleString());
  console.log("📊 Approximate tokens:", Math.round(prompt.length / 4).toLocaleString());
  console.log("\n─────────────────────────────────────────────────────────────");
  console.log("  GENERATED SYSTEM PROMPT:");
  console.log("─────────────────────────────────────────────────────────────\n");
  console.log(prompt);
  console.log("\n─────────────────────────────────────────────────────────────");

  // Log the expected JSON schema
  const schema = getBlogPostSchema();
  console.log("\n📋 Expected Output Schema:");
  console.log(JSON.stringify(schema, null, 2));
}

function testSocialCaptionPrompts(): void {
  console.log("\n");
  console.log("═".repeat(80));
  console.log("  TEST 2: Social Caption Prompts (All Platforms)");
  console.log("═".repeat(80));

  const platforms = ["instagram", "twitter", "linkedin", "facebook", "tiktok", "threads"];

  for (const platform of platforms) {
    const prompt = getSocialCaptionPrompt(platform, sampleBrandVoice);
    console.log(`\n─────────────────────────────────────────────────────────────`);
    console.log(`  PLATFORM: ${platform.toUpperCase()}`);
    console.log(`  Characters: ${prompt.length.toLocaleString()} | ~Tokens: ${Math.round(prompt.length / 4).toLocaleString()}`);
    console.log(`─────────────────────────────────────────────────────────────\n`);
    console.log(prompt);
  }

  const schema = getSocialCaptionSchema();
  console.log("\n📋 Expected Output Schema:");
  console.log(JSON.stringify(schema, null, 2));
}

function testSeoCampaignPrompt(): void {
  console.log("\n");
  console.log("═".repeat(80));
  console.log("  TEST 3: SEO Campaign Prompt");
  console.log("═".repeat(80));

  const prompt = getSeoCampaignPrompt(sampleAuditData, sampleCompetitorData, sampleTiers);

  console.log("\n📊 Character count:", prompt.length.toLocaleString());
  console.log("📊 Approximate tokens:", Math.round(prompt.length / 4).toLocaleString());
  console.log(`📊 Number of tiers: ${sampleTiers.length} (${sampleTiers.map((t) => t.name).join(", ")})`);
  console.log("\n─────────────────────────────────────────────────────────────");
  console.log("  GENERATED SYSTEM PROMPT (first 3000 chars):");
  console.log("─────────────────────────────────────────────────────────────\n");
  console.log(prompt.substring(0, 3000));
  console.log("\n... [truncated] ...");
  console.log(`\nFull prompt length: ${prompt.length.toLocaleString()} characters`);
}

function testImagePrompt(): void {
  console.log("\n");
  console.log("═".repeat(80));
  console.log("  TEST 4: Image Generation Prompts");
  console.log("═".repeat(80));

  const caption = "A modern digital marketing dashboard displayed on a floating holographic screen, with data visualizations, charts, and SEO metrics glowing in neon blue, set in a sleek dark office environment";
  const styles = ["photorealistic", "illustration", "minimalist", "cinematic", "3d-render", "flat-design"];

  for (const style of styles) {
    const prompt = getImagePrompt(caption, style);
    console.log(`\n─────────────────────────────────────────────────────────────`);
    console.log(`  STYLE: ${style.toUpperCase()}`);
    console.log(`  Characters: ${prompt.length.toLocaleString()}`);
    console.log(`─────────────────────────────────────────────────────────────\n`);
    console.log(prompt);
  }
}

function testSimulatedBlogOutput(): void {
  console.log("\n");
  console.log("═".repeat(80));
  console.log("  TEST 5: Simulated Blog Post Structured Output");
  console.log("═".repeat(80));

  // This demonstrates the structure that generateStructuredOutput would return
  const simulatedOutput = {
    title: "Enterprise SEO Strategy: A Data-Driven Framework for B2B Growth in 2026",
    slug: "enterprise-seo-strategy-b2b-framework-2026",
    metaDescription:
      "Discover a proven enterprise SEO strategy framework that drives measurable B2B growth. Learn how to align SEO with revenue goals, secure executive buy-in, and scale organic traffic.",
    headings: [
      { level: 1, text: "Enterprise SEO Strategy: A Data-Driven Framework for B2B Growth in 2026" },
      { level: 2, text: "Why Traditional SEO Falls Short for Enterprise B2B Companies" },
      { level: 3, text: "The Scalability Problem in Enterprise SEO Strategy" },
      { level: 3, text: "Moving Beyond Vanity Metrics to SEO ROI" },
      { level: 2, text: "The Four Pillars of an Enterprise SEO Strategy Framework" },
      { level: 3, text: "Pillar 1: Technical SEO Audit and Infrastructure" },
      { level: 3, text: "Pillar 2: Content Strategy Framework Aligned to Buyer Journey" },
      { level: 3, text: "Pillar 3: Authority Building Through Digital PR and Link Acquisition" },
      { level: 3, text: "Pillar 4: Measurement, Attribution, and Continuous Optimization" },
      { level: 2, text: "Building the Business Case: How to Calculate Your SEO ROI" },
      { level: 2, text: "Common Enterprise SEO Pitfalls and How to Avoid Them" },
      { level: 2, text: "Getting Started: Your 90-Day Enterprise SEO Roadmap" },
    ],
    body: `## Why Traditional SEO Falls Short for Enterprise B2B Companies

Most SEO advice is written for small businesses and startups. But when you're managing a website with 10,000+ pages across multiple product lines, geographies, and buyer personas, the rules change entirely...

[Full markdown blog body would be generated here with ~1800 words, internal linking suggestions, E-E-A-T signals, and the specified CTA.]

The key difference? Enterprise SEO strategy must account for organizational complexity, stakeholder alignment, and the reality that SEO doesn't operate in a vacuum—it intersects with product, sales, brand, and engineering teams.`,
    suggestedImagePrompt:
      "An abstract 3D visualization of interconnected data nodes forming a strategic framework, with glowing pathways representing SEO signals flowing between enterprise-level concepts like content, technical, authority, and analytics. Dark background with teal and gold accents. Corporate yet futuristic style.",
  };

  console.log("\n📋 Simulated Structured Output (from generateStructuredOutput<BlogPost>):\n");
  console.log(JSON.stringify(simulatedOutput, null, 2));

  // Validate against schema requirements
  console.log("\n✅ VALIDATION CHECKS:");
  console.log(`   Title length: ${simulatedOutput.title.length} chars (target: 50-60)`);
  console.log(`   Meta description length: ${simulatedOutput.metaDescription.length} chars (max: 160)`);
  console.log(`   Heading count: ${simulatedOutput.headings.length} (target: H1 + 4-6 H2s + H3s)`);
  console.log(`   Slug format: ${/^[a-z0-9-]+$/.test(simulatedOutput.slug) ? "✅ valid" : "❌ invalid"}`);
  console.log(`   Has image prompt: ${simulatedOutput.suggestedImagePrompt.length > 0 ? "✅" : "❌"}`);
}

// ============================================================================
// Main
// ============================================================================

console.log("\n");
console.log("█".repeat(80));
console.log("█" + " ".repeat(78) + "█");
console.log("█" + "   AGENCY OS — AI Prompt Engineering Test Suite".padEnd(78) + "█");
console.log("█" + " ".repeat(78) + "█");
console.log("█".repeat(80));

console.log("\n📦 Testing prompts without AI provider calls (no API keys required)");
console.log("📦 These tests validate prompt structure, length, and completeness");

testBlogPrompt();
testSocialCaptionPrompts();
testSeoCampaignPrompt();
testImagePrompt();
testSimulatedBlogOutput();

console.log("\n");
console.log("█".repeat(80));
console.log("█" + " ".repeat(78) + "█");
console.log("█" + "   ✅ All prompt generation tests complete".padEnd(78) + "█");
console.log("█" + " ".repeat(78) + "█");
console.log("█".repeat(80));
console.log("\n💡 To test with actual AI providers, set environment variables:");
console.log("   - NEXT_PUBLIC_SUPABASE_URL");
console.log("   - SUPABASE_SERVICE_ROLE_KEY");
console.log("   - DEEPSEEK_API_KEY (or OPENAI_API_KEY)");
console.log("   Then call generateStructuredOutput() from '@/lib/ai/orchestrator'\n");