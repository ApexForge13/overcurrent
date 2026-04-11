import { callModel, parseJSON } from '@/lib/models'
import { JSON_RULES } from './prompts'
import type { RedditDiscoursePost } from '@/ingestion/reddit-discourse'

export interface DiscourseAnalysis {
  posts: Array<{
    post_index: number
    framing_type: string
    sentiment: string
    key_quote: string
  }>
  aggregate: {
    dominant_framing: string
    dominant_framing_pct: number
    secondary_framing: string
    secondary_framing_pct: number
    dominant_sentiment: string
    total_engagement: number
    post_count: number
  }
  gap: {
    media_dominant_frame: string
    media_frame_pct: number
    public_dominant_frame: string
    public_frame_pct: number
    gap_score: number
    gap_direction: string
    gap_summary: string
    public_surfaced_first: string[]
    media_ignored_by_public: string[]
    public_counter_narrative: string
  }
  costUsd: number
}

const SYSTEM_PROMPT = `You are Overcurrent's public discourse analyst. You analyze social media reactions to news stories — NOT to determine truth, but to measure how public interpretation compares to media framing.

You receive:
- A completed media analysis with its dominant framing
- Raw social media posts (Reddit) about the same story

Your job:

1. CLASSIFY each social post:
   - framingType: crime | labor | financial | solidarity | outrage | humor | skepticism | conspiracy | indifference | counter_narrative | other
   - sentiment: positive | negative | neutral | mixed

2. AGGREGATE the discourse:
   - What is the DOMINANT framing across all social posts?
   - What percentage of top posts use that framing?
   - What is the dominant sentiment?

3. MEASURE THE GAP:
   - Compare the media's dominant framing to the public's dominant framing
   - Score the gap 0-100 (0 = perfectly aligned, 100 = diametrically opposed)
   - Direction: "aligned" | "media_leads" | "public_leads" | "opposed"

4. IDENTIFY SPECIFIC GAPS:
   - Facts that surfaced on social media BEFORE any mainstream outlet
   - Mainstream reporting that got near-zero social engagement
   - The dominant counter-narrative on social (if one exists)

CRITICAL RULES:
- Social media posts are NOT evidence. They are reactions.
- You are measuring PERCEPTION, not verifying facts.
- Do not fact-check social media posts. Just classify their framing.
- Humor and memes are data. Classify them.

${JSON_RULES}

{
  "posts": [{ "post_index": 0, "framing_type": "solidarity", "sentiment": "positive", "key_quote": "..." }],
  "aggregate": { "dominant_framing": "solidarity", "dominant_framing_pct": 73, "secondary_framing": "outrage", "secondary_framing_pct": 15, "dominant_sentiment": "mixed", "total_engagement": 648000, "post_count": 47 },
  "gap": { "media_dominant_frame": "crime", "media_frame_pct": 92, "public_dominant_frame": "solidarity", "public_frame_pct": 73, "gap_score": 65, "gap_direction": "opposed", "gap_summary": "...", "public_surfaced_first": ["..."], "media_ignored_by_public": ["..."], "public_counter_narrative": "..." }
}`

export async function analyzeDiscourse(
  mediaSummary: { headline: string; dominantFraming: string; framingPct: number; claims: string[] },
  socialPosts: RedditDiscoursePost[],
  storyId?: string,
): Promise<DiscourseAnalysis> {
  const postsText = socialPosts
    .map((p, i) => `[${i}] r/${p.subreddit} · ${p.upvotes} upvotes · ${p.comments} comments\n${p.content}\nTop comments: ${p.topComments.map(c => `"${c.text.substring(0, 200)}" (${c.upvotes} upvotes)`).join(' | ')}`)
    .join('\n\n---\n\n')

  const userPrompt = `MEDIA ANALYSIS SUMMARY:
Headline: ${mediaSummary.headline}
Dominant media framing: ${mediaSummary.dominantFraming} (${mediaSummary.framingPct}% of outlets)
Key claims: ${mediaSummary.claims.join('; ')}

SOCIAL MEDIA POSTS (${socialPosts.length} posts from Reddit):

${postsText}`

  const result = await callModel({
    provider: 'anthropic',
    tier: 'fast', // Haiku — cheap
    system: SYSTEM_PROMPT,
    userMessage: userPrompt,
    maxTokens: 4096,
    agentType: 'discourse',
    storyId,
  })

  const parsed = parseJSON<Omit<DiscourseAnalysis, 'costUsd'>>(result.text)

  return {
    posts: parsed.posts ?? [],
    aggregate: parsed.aggregate ?? {
      dominant_framing: 'unknown',
      dominant_framing_pct: 0,
      secondary_framing: 'unknown',
      secondary_framing_pct: 0,
      dominant_sentiment: 'unknown',
      total_engagement: 0,
      post_count: 0,
    },
    gap: parsed.gap ?? {
      media_dominant_frame: mediaSummary.dominantFraming,
      media_frame_pct: mediaSummary.framingPct,
      public_dominant_frame: 'unknown',
      public_frame_pct: 0,
      gap_score: 0,
      gap_direction: 'aligned',
      gap_summary: 'Insufficient social data to measure gap.',
      public_surfaced_first: [],
      media_ignored_by_public: [],
      public_counter_narrative: '',
    },
    costUsd: result.costUsd,
  }
}
