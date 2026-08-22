import { z } from "@medusajs/framework/zod";

export const EditAuthoringRequestSchema = z
  .object({
    state: z.enum(["authoring", "ready", "blocked"]).optional(),
    blocked_reason: z.string().nullish(),
    seo_title: z.string().nullish(),
    seo_description: z.string().nullish(),
    colour: z.string().nullish(),
    merchandising_rank: z.number().int().min(0).optional(),
  })
  .refine((body) => Object.keys(body).length > 0, {
    message: "The request must carry at least one field.",
  });

export type EditAuthoringRequest = z.infer<typeof EditAuthoringRequestSchema>;
