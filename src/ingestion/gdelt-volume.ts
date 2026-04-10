import { fetchWithTimeout } from '@/lib/utils'

export interface VolumeDataPoint {
  date: string
  volume: number
}

export interface ThemeResult {
  theme: string
  volume: number
}

const GDELT_BASE = 'https://api.gdeltproject.org/api/v2/doc/doc'

/**
 * Get daily article volume for a topic over a time period.
 * Defaults to past 30 days.
 */
export async function getTopicVolume(
  query: string,
  timespan?: string,
): Promise<VolumeDataPoint[]> {
  try {
    const params = new URLSearchParams({
      query,
      mode: 'TimelineVol',
      format: 'json',
      timespan: timespan ?? '30d',
    })

    const url = `${GDELT_BASE}?${params.toString()}`
    const response = await fetchWithTimeout(url)
    if (!response.ok) return []

    const text = await response.text()
    if (text.trimStart().startsWith('<')) return []

    const data = JSON.parse(text)
    const timeline = data?.timeline
    if (!Array.isArray(timeline) || timeline.length === 0) return []

    // GDELT TimelineVol returns an array of series; use the first one
    const series = timeline[0]
    const dataPoints = series?.data
    if (!Array.isArray(dataPoints)) return []

    return dataPoints.map((point: Record<string, unknown>) => ({
      date: String(point.date ?? ''),
      volume: Number(point.value ?? 0),
    }))
  } catch {
    return []
  }
}

/**
 * Get top themes from GDELT articles for a given time period.
 * Uses ArtList mode with a broad query and extracts themes from results.
 */
export async function getTopThemes(
  startDate: string,
  endDate: string,
): Promise<ThemeResult[]> {
  try {
    // Calculate timespan from date range
    const start = new Date(startDate)
    const end = new Date(endDate)
    const diffDays = Math.max(
      1,
      Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)),
    )
    const timespan = `${diffDays}d`

    const params = new URLSearchParams({
      query: 'theme:*',
      mode: 'TimelineVolInfo',
      format: 'json',
      timespan,
    })

    const url = `${GDELT_BASE}?${params.toString()}`
    const response = await fetchWithTimeout(url)
    if (!response.ok) {
      // Fallback: use ArtList to extract themes from article metadata
      return await getThemesFromArticles(timespan)
    }

    const text = await response.text()
    if (text.trimStart().startsWith('<')) {
      return await getThemesFromArticles(timespan)
    }

    const data = JSON.parse(text)
    const timeline = data?.timeline
    if (!Array.isArray(timeline)) {
      return await getThemesFromArticles(timespan)
    }

    // Each entry in timeline represents a theme series
    const themes: ThemeResult[] = timeline
      .filter((series: Record<string, unknown>) => series.series)
      .map((series: Record<string, unknown>) => {
        const dataPoints = (series.data as Array<{ value: number }>) ?? []
        const totalVolume = dataPoints.reduce(
          (sum, point) => sum + (Number(point.value) || 0),
          0,
        )
        return {
          theme: String(series.series),
          volume: totalVolume,
        }
      })
      .sort((a, b) => b.volume - a.volume)

    return themes
  } catch {
    return []
  }
}

/**
 * Fallback: extract themes from article list metadata.
 */
async function getThemesFromArticles(
  timespan: string,
): Promise<ThemeResult[]> {
  try {
    const params = new URLSearchParams({
      query: '',
      mode: 'ArtList',
      maxrecords: '50',
      format: 'json',
      sort: 'DateDesc',
      timespan,
    })

    const url = `${GDELT_BASE}?${params.toString()}`
    const response = await fetchWithTimeout(url)
    if (!response.ok) return []

    const text = await response.text()
    if (text.trimStart().startsWith('<')) return []

    const data = JSON.parse(text)
    const articles = data?.articles
    if (!Array.isArray(articles)) return []

    // Count domain occurrences as a rough proxy for themes
    const domainCounts = new Map<string, number>()
    for (const article of articles) {
      const domain = String(article.domain ?? '')
      if (domain) {
        domainCounts.set(domain, (domainCounts.get(domain) ?? 0) + 1)
      }
    }

    return Array.from(domainCounts.entries())
      .map(([theme, volume]) => ({ theme, volume }))
      .sort((a, b) => b.volume - a.volume)
  } catch {
    return []
  }
}
