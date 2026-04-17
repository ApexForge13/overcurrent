export type ContentQuality = 'FULL' | 'PARTIAL' | 'SNIPPET'

export interface ArticleContent {
  title: string
  content: string
  excerpt?: string
  byline?: string
  siteName?: string
  length: number
  contentQuality: ContentQuality
}

const MAX_WORDS = 3_000

/**
 * Classify content quality by word count.
 * FULL: 200+ words — complete article text
 * PARTIAL: 50-199 words — truncated or partial extraction
 * SNIPPET: <50 words — headline + RSS snippet only
 */
function classifyQuality(wordCount: number): ContentQuality {
  if (wordCount >= 200) return 'FULL'
  if (wordCount >= 50) return 'PARTIAL'
  return 'SNIPPET'
}

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
 * If full-text extraction fails (403, paywall, etc.), falls back to RSS snippet.
 * Returns null if extraction fails and no snippet is available.
 * Content is truncated to 3000 words max to control token usage.
 */
export async function fetchArticle(
  url: string,
  rssSnippet?: string,
  rssTitle?: string,
): Promise<ArticleContent | null> {
  try {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 30_000)

    const fetchHeaders = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
    }

    let html: string
    try {
      let response = await fetch(url, {
        signal: controller.signal,
        headers: fetchHeaders,
        redirect: 'follow',
      })

      // If blocked (403/451), try Google webcache as fallback
      if (response.status === 403 || response.status === 451) {
        console.warn(`[fetch] HTTP ${response.status} for ${url} — trying Google cache...`)
        try {
          const cacheUrl = `https://webcache.googleusercontent.com/search?q=cache:${encodeURIComponent(url)}`
          const cacheResp = await fetch(cacheUrl, {
            signal: controller.signal,
            headers: fetchHeaders,
          })
          if (cacheResp.ok) {
            response = cacheResp
            console.log(`[fetch] Google cache hit for ${url}`)
          }
        } catch {
          // Cache attempt failed, continue to snippet fallback
        }
      }

      if (!response.ok) {
        console.warn(`[fetch] HTTP ${response.status} for ${url}`)
        // Fall back to RSS snippet if available
        if (rssSnippet && rssSnippet.length >= 50) {
          const snippetText = stripHtml(rssSnippet)
          const wordCount = snippetText.split(/\s+/).length
          console.log(`[fetch] Using RSS snippet fallback for ${url} (${wordCount} words, ${classifyQuality(wordCount)})`)
          return {
            title: rssTitle || '',
            content: truncateWords(snippetText, MAX_WORDS),
            excerpt: snippetText.slice(0, 200),
            length: wordCount,
            contentQuality: classifyQuality(wordCount),
          }
        }
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
          const wordCount = truncated.split(/\s+/).length
          return {
            title: article.title ?? '',
            content: truncated,
            excerpt: article.excerpt ?? undefined,
            byline: article.byline ?? undefined,
            siteName: article.siteName ?? undefined,
            length: wordCount,
            contentQuality: classifyQuality(wordCount),
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
      if (rssSnippet && rssSnippet.length >= 50) {
        const snippetText = stripHtml(rssSnippet)
        const wc = snippetText.split(/\s+/).length
        console.log(`[fetch] Using RSS snippet fallback for ${url} (${wc} words, ${classifyQuality(wc)})`)
        return {
          title: rssTitle || title || '',
          content: truncateWords(snippetText, MAX_WORDS),
          excerpt: snippetText.slice(0, 200),
          length: wc,
          contentQuality: classifyQuality(wc),
        }
      }
      return null
    }

    const plainText = stripHtml(bodyHtml)
    if (plainText.length < 50) {
      console.warn(`[fetch] Content too short (${plainText.length} chars) for ${url}`)
      if (rssSnippet && rssSnippet.length >= 50) {
        const snippetText = stripHtml(rssSnippet)
        const wc = snippetText.split(/\s+/).length
        console.log(`[fetch] Using RSS snippet fallback for ${url} (${wc} words, ${classifyQuality(wc)})`)
        return {
          title: rssTitle || title || '',
          content: truncateWords(snippetText, MAX_WORDS),
          excerpt: snippetText.slice(0, 200),
          length: wc,
          contentQuality: classifyQuality(wc),
        }
      }
      return null
    }

    const truncated = truncateWords(plainText, MAX_WORDS)
    const wordCount = truncated.split(/\s+/).length
    return {
      title,
      content: truncated,
      length: wordCount,
      contentQuality: classifyQuality(wordCount),
    }
  } catch (err) {
    console.warn(`[fetch] Extraction error for ${url}:`, err instanceof Error ? err.message : err)

    // Try Wayback Machine for sites that block us at the network level (PressTV, Tasnim, etc.)
    try {
      const waybackUrl = `https://web.archive.org/web/2026/${url}`
      const waybackResp = await fetch(waybackUrl, {
        signal: AbortSignal.timeout(15_000),
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        },
      })
      if (waybackResp.ok) {
        const waybackHtml = await waybackResp.text()
        const jsdom = await import('jsdom')
        const { Readability } = await import('@mozilla/readability')
        const virtualConsole = new jsdom.VirtualConsole()
        virtualConsole.on('error', () => {})
        const dom = new jsdom.JSDOM(waybackHtml, { url, virtualConsole })
        const reader = new Readability(dom.window.document)
        const article = reader.parse()
        if (article?.content) {
          const plainText = stripHtml(article.content)
          if (plainText && plainText.length > 50) {
            const truncated = truncateWords(plainText, MAX_WORDS)
            const wordCount = truncated.split(/\s+/).length
            console.log(`[fetch] Wayback Machine hit for ${url} (${wordCount} words)`)
            return {
              title: article.title ?? rssTitle ?? '',
              content: truncated,
              length: wordCount,
              contentQuality: classifyQuality(wordCount),
            }
          }
        }
      }
    } catch {
      // Wayback also failed — fall through to snippet
    }

    // Fall back to RSS snippet if available
    if (rssSnippet && rssSnippet.length >= 50) {
      const snippetText = stripHtml(rssSnippet)
      const wc = snippetText.split(/\s+/).length
      console.log(`[fetch] Using RSS snippet fallback for ${url} (${wc} words, ${classifyQuality(wc)})`)
      return {
        title: rssTitle || '',
        content: truncateWords(snippetText, MAX_WORDS),
        excerpt: snippetText.slice(0, 200),
        length: wc,
        contentQuality: classifyQuality(wc),
      }
    }
    return null
  }
}
