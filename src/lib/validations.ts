import { z } from "zod";

export const generateContentSchema = z.object({
  clientId: z.string().uuid().optional(),
  topic: z.string().min(5, "Topic must be at least 5 characters"),
  brandVoice: z.string().optional(),
  platforms: z.array(z.string()).min(1, "Select at least one platform"),
});

export type GenerateContentInput = z.infer<typeof generateContentSchema>;