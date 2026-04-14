export interface ArticleContent {
  title: string
  content: string
  excerpt?: string
  byline?: string
  siteName?: string
  length: number
}

const MAX_WORDS = 3_000

/**
 * Strip HTML tags and normalize whitespace to produce plain text.
 */
function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Truncate text to a maximum word count.
 */
function truncateWords(text: string, maxWords: number): string {
  const words = text.split(/\s+/)
  if (words.length <= maxWords) return text
  return words.slice(0, maxWords).join(' ')
}

/**
 * Fetch a URL and extract the main article content.
 * Uses jsdom + Readability when available, falls back to regex extraction.
 * Returns null if extraction fails.
 * Content is truncated to 3000 words max to control token usage.
 */
export async function fetchArticle(
  url: string,
): Promise<ArticleContent | null> {
  try {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 30_000)

    let html: string
    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
      })

      if (!response.ok) {
        console.warn(`[fetch] HTTP ${response.status} for ${url}`)
        return null
      }
      html = await response.text()
    } finally {
      clearTimeout(timeoutId)
    }

    // Try jsdom + Readability first (may not be available in serverless)
    try {
      const jsdom = await import('jsdom')
      const { Readability } = await import('@mozilla/readability')
      const virtualConsole = new jsdom.VirtualConsole()
      virtualConsole.on('error', () => {}) // Suppress CSS parse warnings
      const dom = new jsdom.JSDOM(html, { url, virtualConsole })
      const reader = new Readability(dom.window.document)
      const article = reader.parse()

      if (article?.content) {
        const plainText = stripHtml(article.content)
        if (plainText) {
          const truncated = truncateWords(plainText, MAX_WORDS)
          return {
            title: article.title ?? '',
            content: truncated,
            excerpt: article.excerpt ?? undefined,
            byline: article.byline ?? undefined,
            siteName: article.siteName ?? undefined,
            length: truncated.split(/\s+/).length,
          }
        }
      }
    } catch (err) {
      console.warn(`[fetch] jsdom/readability failed for ${url}:`, err instanceof Error ? err.message : err)
    }

    // Fallback: regex-based extraction
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i)
    const title = titleMatch ? stripHtml(titleMatch[1]) : ''

    // Try to extract from <article> tag (greedy), then <main>, then paragraphs
    let bodyHtml = ''
    const articleMatch = html.match(/<article[^>]*>([\s\S]*)<\/article>/i)
    const mainMatch = html.match(/<main[^>]*>([\s\S]*)<\/main>/i)

    if (articleMatch) {
      bodyHtml = articleMatch[1]
    } else if (mainMatch) {
      bodyHtml = mainMatch[1]
    } else {
      // Extract paragraphs
      const paragraphs = html.match(/<p[^>]*>[\s\S]*?<\/p>/gi)
      if (paragraphs) {
        bodyHtml = paragraphs.join(' ')
      }
    }

    if (!bodyHtml) {
      console.warn(`[fetch] No body content extracted from ${url}`)
      return null
    }

    const plainText = stripHtml(bodyHtml)
    if (plainText.length < 50) {
      console.warn(`[fetch] Content too short (${plainText.length} chars) for ${url}`)
      return null
    }

    const truncated = truncateWords(plainText, MAX_WORDS)
    return {
      title,
      content: truncated,
      length: truncated.split(/\s+/).length,
    }
  } catch (err) {
    console.warn(`[fetch] Extraction error for ${url}:`, err instanceof Error ? err.message : err)
    return null
  }
}
