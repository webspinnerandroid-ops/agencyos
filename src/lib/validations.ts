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
    // Social platforms are OPTIONAL — a blog-only generation (no social
    // captions) is a supported and common case, so an empty/absent list must
    // not fail validation. The blog post is always generated.
    platforms: z.array(z.string()).optional(),
  })
  .refine(
    (v) =>
      !!v.title ||
      !!v.topic ||
      (Array.isArray(v.keywords) && v.keywords.length > 0),
    {
      message: "Provide a title, keywords, or a topic to generate from.",
      path: ["title"],
    }
  );

export type GenerateContentInput = z.infer<typeof generateContentSchema>;