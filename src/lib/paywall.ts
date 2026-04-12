const FREE_READS = 5
const STORAGE_KEY = 'overcurrent_reads'

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

// Check if user has exceeded free reads
export function isPaywalled(readCount: number): boolean {
  return readCount > FREE_READS
}

export function remainingReads(readCount: number): number {
  return Math.max(0, FREE_READS - readCount)
}

export { FREE_READS }
