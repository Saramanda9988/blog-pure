import { z } from 'astro/zod'

import { Icons, type IconsType } from '../libs/icons'

const icons = Object.keys(Icons) as [IconsType, ...IconsType[]]

export const IconSchema = () => z.enum(icons)
