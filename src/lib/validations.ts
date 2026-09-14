import { z } from "zod";

export const generateContentSchema = z
  .object({
    clientId: z.string().uuid().optional(),
    // The user may supply a title, keywords/topics, or both — generation works
    // from whichever is given (research runs first either way).
    title: z.string().min(5, "Title must be at least 5 characters").optional(),
    topic: z.string().min(5, "Topic must be at least 5 characters").optional(),
    keywords: z.array(z.string().min(1)).optional(),
    brandVoice: z.string().optional(),
    // How many images to generate for the blog: 0 = none, 1 = featured only,
    // 2 = featured + 1 inline, 3 = featured + 2 inline.
    imageCount: z.number().int().min(0).max(3).optional(),
    // "To illustrate key points" mode: the model chooses where inline images
    // genuinely illustrate a key point (featured + up to 2 more). Wins over
    // imageCount when true.
    imageAuto: z.boolean().optional(),
    // Social-only generation (Content Map social rows): skips the blog post
    // entirely and writes one platform-native post per social platform from
    // the topic/keywords/brand voice.
    socialOnly: z.boolean().optional(),
    // Preferred external sources to cite (optional; up to 5). Empty/absent is
    // normal — the model then picks its own reputable sources. Internal links
    // are never provided here; they come from the workspace knowledge base.
    externalLinks: z
      .array(z.string().url())
      .max(5)
      .optional(),
    // Suggested publish date/time (ISO) — from the Content Map row or the
    // CSV's Publish Date column. Stored on the draft as a suggestion; the
    // draft still goes through the normal approval flow before publishing.
    // Optional — absent means "no suggested time".
    scheduledAt: z.string().datetime({ offset: true }).optional(),
    // User-uploaded images (already persisted to storage) that replace the
    // AI-generated ones. First entry is the featured image, the rest inline.
    uploadedImages: z
      .array(
        z.object({
          url: z.string().url(),
          placement: z.enum(["featured", "inline"]),
          description: z.string().optional(),
        })
      )
      .max(3)
      .optional(),
    // Social platforms are OPTIONAL — a blog-only generation (no social
    // captions) is a supported and common case, so an empty/absent list must
    // not fail validation. The blog post is always generated.
    platforms: z.array(z.string()).optional(),
    // Auto-publish target from the Content Map row (migration 104):
    // "wordpress" = after a gate-cleared blog generation, auto-approve the
    // draft and schedule it to the connected WordPress sites for the row's
    // publish date. Omitted/null = the draft stays draft (manual flow).
    autoPublish: z.enum(["wordpress"]).optional(),
    // JSON-LD schema types to generate with the post (Article is always
    // included). "auto" detects from the content (FAQPage from Q&A pairs,
    // HowTo/Recipe from numbered steps).
    // JSON-LD schema types to generate with the post (Article is always
    // included). "auto" detects from the content (FAQPage from Q&A pairs,
    // HowTo/Recipe from numbered steps). Everything above is OPTIONAL — when
    // no title/topic/keywords are given, the backend auto-selects a topic
    // from the questions people are asking (trends).
    schemaTypes: z
      .union([
        z.array(
          z.enum([
            "Article",
            "FAQPage",
            "HowTo",
            "Recipe",
            "Product",
            "Service",
            "Organization",
            "LocalBusiness",
            "Event",
            "Course",
            "SoftwareApplication",
            "VideoObject",
            "Person",
          ])
        ),
        z.literal("auto"),
      ])
      .optional(),
  });

export type GenerateContentInput = z.infer<typeof generateContentSchema>;