import { z } from 'astro/zod'

import { IconSchema } from './icon'

const LinksSchema = z
  .object({ icon: IconSchema(), label: z.string().min(1), href: z.string() })
  .array()
  .optional()

export const SocialLinksSchema = () =>
  z.preprocess((value, ctx) => {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      ctx.issues.push({
        code: 'custom',
        message: 'The `footer.social` configuration must be an array of link items.',
        input: value
      })
    }
    return value
  }, LinksSchema) as unknown as typeof LinksSchema
