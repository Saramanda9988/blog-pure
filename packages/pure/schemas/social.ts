import { z } from 'astro/zod'

import { socialLinks } from '../types/constants'

export const SocialLinksSchema = () =>
  z
    .object(
      Object.fromEntries(
        socialLinks.map((link) => [
          link,
          // Link to the respective social profile for this site
          z.string().url().optional()
        ])
      ) as Record<(typeof socialLinks)[number], z.ZodOptional<z.ZodString>>
    )
    .transform((links) => {
      const labelledLinks: Partial<Record<keyof typeof links, { label: string; url: string }>> = {}
      for (const _k in links) {
        const key = _k as keyof typeof links
        const url = links[key]
        if (!url) continue
        const label = {
          github: 'GitHub',
          gitlab: 'GitLab',
          discord: 'Discord',
          youtube: 'YouTube',
          instagram: 'Instagram',
          x: 'X',
          telegram: 'Telegram',
          rss: 'RSS',
          email: 'Email',
          reddit: 'Reddit',
          bluesky: 'BlueSky',
          tiktok: 'TikTok',
          weibo: 'Weibo',
          steam: 'Steam',
          bilibili: 'Bilibili',
          zhihu: 'Zhihu',
          coolapk: 'Coolapk',
          netease: 'NetEase'
        }[key]
        labelledLinks[key] = { label, url }
      }
      return labelledLinks
    })
    .optional()
