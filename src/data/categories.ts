export const CATEGORIES = {
  conflict:     { label: 'Conflict & security', color: 'var(--accent-red)' },
  politics:     { label: 'Politics & governance', color: 'var(--accent-blue)' },
  economy:      { label: 'Economy & finance', color: 'var(--accent-green)' },
  tech:         { label: 'Technology & AI', color: 'var(--accent-purple)' },
  labor:        { label: 'Labor & work', color: 'var(--accent-amber)' },
  climate:      { label: 'Climate & energy', color: 'var(--accent-green)' },
  health:       { label: 'Health & science', color: 'var(--accent-blue)' },
  society:      { label: 'Society & culture', color: 'var(--accent-amber)' },
  trade:        { label: 'Trade & global economy', color: 'var(--accent-blue)' },
  undercurrent: { label: 'Undercurrent', color: 'var(--accent-purple)' },
} as const

export type CategorySlug = keyof typeof CATEGORIES

export const CATEGORY_SLUGS = Object.keys(CATEGORIES) as CategorySlug[]

export function getCategoryLabel(slug: string): string {
  return CATEGORIES[slug as CategorySlug]?.label ?? slug
}

export function getCategoryColor(slug: string): string {
  return CATEGORIES[slug as CategorySlug]?.color ?? 'var(--text-tertiary)'
}
