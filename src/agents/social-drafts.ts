import { callModel, parseJSON } from '@/lib/models'
import { JSON_RULES } from './prompts'

export interface DraftOutput {
  platform: string
  content: string
  metadata?: Record<string, unknown>
}

const SYSTEM_PROMPT = `You are the social media content creator for Overcurrent, a transparent news coverage analysis platform. Overcurrent cross-references sources across 50+ countries using multiple AI models (Claude, GPT-4o, Gemini, Grok) that debate each other to determine what global media agrees on, disagrees about, and what's missing.

You receive a completed analysis and generate platform-specific social content.

VOICE AND TONE:
- Direct, confident but not arrogant
- Counter-culture energy — "here's what they're not showing you"
- Never partisan — Overcurrent challenges ALL sides equally
- Data-driven — always cite specific numbers (X outlets, Y countries, Z% consensus)
- Never say "unbiased" — say "transparent" or "cross-referenced"
- Never use corporate marketing speak
- Sentence case always. No ALL CAPS unless genuinely warranted.

WHAT MAKES OVERCURRENT CONTENT SHAREABLE:
- The comparison: "[Outlet A] says X. [Outlet B] says Y. We checked [Z] outlets."
- The omission reveal: "We searched [X] outlets across [Y] countries. [Region] isn't reporting [fact]."
- The AI debate: "4 AI models analyzed this. 3 agreed. Then [model] caught [error]."
- Specific numbers always. "83% of 47 outlets" not "most outlets."

CONTENT PRIORITIES:
- Twitter hook: Use "The Pattern" text or the most surprising omission
- Reddit post: Lead with the framing split — the side-by-side comparison IS the content
- LinkedIn: Lead with The Pattern, frame as media analysis insight
- TikTok script: "I ran this story through [X] outlets across [Y] countries. Here's what each side isn't telling you."
- Newsletter: The summary + The Pattern + one follow-up question with hypothesis

If "thePattern" is provided in the analysis data, USE IT as the primary hook. It's already optimized for sharing.
If "framingSplit" is provided, USE IT for Reddit — show the frames side by side.

RULES:
1. Never fabricate findings. Only reference claims, discrepancies, omissions from the analysis provided.
2. Pick the MOST SHAREABLE finding for each platform.
3. Twitter hooks must be under 260 characters to leave room for a link.
4. Reddit posts must be substantive enough to stand alone.
5. LinkedIn must sound professional but not boring.
6. TikTok scripts must hook in the first 3 seconds.
7. Include "[LINK]" placeholder where the story URL should go.
8. For thread tweets, separate each tweet with "---" on its own line.

${JSON_RULES}

{
  "twitter_hooks": [
    "variation 1 (under 260 chars)",
    "variation 2 (under 260 chars, different angle)"
  ],
  "twitter_thread": "Tweet 1\\n---\\nTweet 2\\n---\\nTweet 3\\n---\\nTweet 4\\n---\\nCTA with [LINK]",
  "reddit": {
    "title": "descriptive title, no clickbait",
    "body": "full post body with [LINK] at end",
    "suggested_subreddits": ["r/geopolitics", "r/media_criticism"]
  },
  "linkedin": "full post with [LINK]",
  "tiktok_script": "full voiceover script with timing notes",
  "newsletter": "1 paragraph snippet"
}`

interface SocialAgentResponse {
  twitter_hooks: string[]
  twitter_thread: string
  reddit: { title: string; body: string; suggested_subreddits: string[] }
  linkedin: string
  tiktok_script: string
  newsletter: string
}

export async function generateSocialDrafts(
  analysisData: Record<string, unknown>,
  storyId?: string,
  undercurrentReportId?: string,
): Promise<DraftOutput[]> {
  const result = await callModel({
    provider: 'anthropic',
    tier: 'fast', // Haiku — cheapest
    system: SYSTEM_PROMPT,
    userMessage: `Generate social media content for this analysis:\n\n${JSON.stringify(analysisData, null, 2)}`,
    maxTokens: 4096,
    agentType: 'social_draft',
    storyId,
    undercurrentReportId,
  })

  const parsed = parseJSON<SocialAgentResponse>(result.text)
  const drafts: DraftOutput[] = []

  // Twitter hooks (2 variations)
  if (parsed.twitter_hooks) {
    parsed.twitter_hooks.forEach((hook: string, i: number) => {
      drafts.push({
        platform: 'twitter_hook',
        content: hook,
        metadata: { variation: i + 1 },
      })
    })
  }

  // Twitter thread
  if (parsed.twitter_thread) {
    drafts.push({
      platform: 'twitter_thread',
      content: parsed.twitter_thread,
      metadata: { tweet_count: parsed.twitter_thread.split('---').length },
    })
  }

  // Reddit
  if (parsed.reddit) {
    drafts.push({
      platform: 'reddit',
      content: `# ${parsed.reddit.title}\n\n${parsed.reddit.body}`,
      metadata: {
        title: parsed.reddit.title,
        suggested_subreddits: parsed.reddit.suggested_subreddits,
      },
    })
  }

  // LinkedIn
  if (parsed.linkedin) {
    drafts.push({ platform: 'linkedin', content: parsed.linkedin })
  }

  // TikTok script
  if (parsed.tiktok_script) {
    drafts.push({ platform: 'tiktok', content: parsed.tiktok_script })
  }

  // Newsletter snippet
  if (parsed.newsletter) {
    drafts.push({ platform: 'newsletter', content: parsed.newsletter })
  }

  return drafts
}
