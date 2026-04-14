// ── Metered access tiers ──────────────────────────────────────────────
// Tier 1: Anonymous users get ANON_FREE_READS full articles (localStorage)
// Tier 2: Signed-up users get SIGNUP_FREE_READS total (user_metadata)
// Tier 3: After SIGNUP_FREE_READS, hard paywall → /subscribe
export const ANON_FREE_READS = 3
export const SIGNUP_FREE_READS = 5
const STORAGE_KEY = 'overcurrent_reads'

export type AccessTier = 'free' | 'signup_wall' | 'paywall'

/** Determine which tier a user falls into based on read count and auth state. */
export function getAccessTier(readCount: number, isLoggedIn: boolean): AccessTier {
  if (!isLoggedIn) {
    // Anonymous: 1-3 free, 4+ signup wall
    return readCount < ANON_FREE_READS ? 'free' : 'signup_wall'
  }
  // Logged in: 1-5 free, 6+ paywall
  return readCount < SIGNUP_FREE_READS ? 'free' : 'paywall'
}

// Get read count from localStorage (anonymous users)
export function getLocalReadCount(): number {
  if (typeof window === 'undefined') return 0
  try {
    const reads = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]')
    return Array.isArray(reads) ? reads.length : 0
  } catch {
    return 0
  }
}

// Record a read in localStorage
export function recordLocalRead(slug: string): number {
  if (typeof window === 'undefined') return 0
  try {
    const reads: string[] = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]')
    if (!reads.includes(slug)) {
      reads.push(slug)
      localStorage.setItem(STORAGE_KEY, JSON.stringify(reads))
    }
    return reads.length
  } catch {
    return 0
  }
}

export function remainingFreeReads(readCount: number, isLoggedIn: boolean): number {
  const limit = isLoggedIn ? SIGNUP_FREE_READS : ANON_FREE_READS
  return Math.max(0, limit - readCount)
}
