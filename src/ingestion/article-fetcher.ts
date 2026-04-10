import { JSDOM } from 'jsdom'
import { Readability } from '@mozilla/readability'

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
 * Fetch a URL and extract the main article content using Readability.
 * Returns null if extraction fails.
 * Content is truncated to 3000 words max to control token usage.
 */
export async function fetchArticle(
  url: string,
): Promise<ArticleContent | null> {
  try {
    // Use fetch directly with AbortController for custom headers
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 30_000)

    let html: string
    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          'User-Agent':
            'Mozilla/5.0 (compatible; Overcurrent/1.0; +https://overcurrent.app)',
        },
      })

      if (!response.ok) return null
      html = await response.text()
    } finally {
      clearTimeout(timeoutId)
    }

    // Parse HTML with JSDOM
    const dom = new JSDOM(html, { url })
    const reader = new Readability(dom.window.document)
    const article = reader.parse()

    if (!article || !article.content) return null

    // Strip HTML to get plain text
    const plainText = stripHtml(article.content)
    if (!plainText) return null

    // Truncate to max words
    const truncated = truncateWords(plainText, MAX_WORDS)
    const wordCount = truncated.split(/\s+/).length

    return {
      title: article.title ?? '',
      content: truncated,
      excerpt: article.excerpt ?? undefined,
      byline: article.byline ?? undefined,
      siteName: article.siteName ?? undefined,
      length: wordCount,
    }
  } catch {
    return null
  }
}
