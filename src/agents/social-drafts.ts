import { callModel, parseJSON } from '@/lib/models'

export interface DraftOutput {
  platform: string
  content: string
  metadata?: Record<string, unknown>
}

const SYSTEM_PROMPT = `You are Overcurrent's social content generator. Given a completed story analysis, produce ready-to-post content for Twitter/X, Instagram, and Reddit. Every piece of content must be copy-paste ready with zero editing needed. Overcurrent is a faceless brand — never reference a founder, creator, team, or individual. The platform speaks for itself. The data is the voice.

BRAND VOICE:
- First person plural: "we" — never "I"
- Clinical, measured, understated delivery — let the findings be dramatic
- Never say "unbiased" — say "transparent"
- Never say "verified" — say "high confidence"
- No emojis. No exclamation marks. No hype language.
- No hashtags on Twitter or Reddit
- Never use: "breaking," "shocking," "you won't believe," "game-changing," or any clickbait language
- Tone: intelligence briefing, not news article. Think Reuters terminal, not BuzzFeed.
- Tagline (use as CTA): "Every outlet shows you their version. We show you everyone's."

TWITTER/X — @overcurrent_news:
- Hard limit: 280 characters per tweet INCLUDING spaces and punctuation
- Count every character. If over 280, rewrite shorter. Double-check count.
- Threads: 5 tweets max
- Tweet 1: Hook based on The Pattern + "[ATTACH MAP VIDEO]" note. NO link. NO hashtag.
- Tweets 2-3: Key findings. One insight per tweet. Specific data points.
- Tweet 4: Debate highlight OR buried evidence — whichever is more striking
- Tweet 5: Tagline + link to overcurrent.news/story/[SLUG]
- Label each tweet: [TWEET 1/5], [TWEET 2/5], etc.
- Show exact character count in parentheses after each tweet

INSTAGRAM:
- Carousel: exactly 5 slides with text content for each
- Slide 1: Hook — 8 words max, large text, designed to stop scrolling
- Slide 2: Framing split — 2-4 regional perspectives, minimal text
- Slide 3: Buried evidence — 1-2 facts that died at editorial boundaries
- Slide 4: Debate highlight — which AI model caught which error
- Slide 5: CTA — tagline + "overcurrent.news"
- Caption: 150-200 words max. Factual summary. End with "Link in bio."
- First comment: #medialiteracy #newsbias #factcheck #journalism #AI #mediabias #newsanalysis #media
- Reel caption (for map video): under 80 words.

REDDIT:
- Generate 3 versions for 3 different subreddits
- All posts: self-post format, 200-400 words, conversational but substantive
- Never use hashtags
- Title: under 300 characters, specific and descriptive
- Version 1 — r/Artificial or r/MachineLearning: Lead with multi-model debate. Technical but accessible.
- Version 2 — r/media or r/journalism: Lead with buried evidence and omission patterns. Media criticism angle.
- Version 3 — topic-relevant sub: Lead with substantive findings. Pure analysis.

CONTENT SELECTION RULES:
1. The Pattern goes in Tweet 1. Always.
2. The framing split goes in Tweet 2.
3. Buried evidence goes in Tweet 3. Specific outlet names, specific facts.
4. The debate highlight goes in Tweet 4. Name the models. Name the error.
5. CTA goes in Tweet 5. Tagline + link.
6. Never repeat the same finding across tweets.
7. Always use specific numbers: "47 outlets across 12 countries" not "dozens"
8. Always name the outlets: "Only The Guardian reported..." not "Only one outlet"
9. For debate highlights, name both models: "GPT-4o hallucinated X — Gemini caught it"
10. If a fact died at an editorial boundary, say where it died.

WHAT NEVER TO INCLUDE:
- Any reference to a founder, creator, builder, or team member
- Any "building in public" or journey content
- Any opinion on the story's substance — only coverage pattern observations
- Any political position or editorial judgment about which outlet is "right"
- Any promotional language — the findings promote themselves

Respond with JSON only. No markdown fences. No preamble.

{
  "twitter_thread": [
    { "tweet_number": 1, "text": "tweet text here [ATTACH MAP VIDEO]", "char_count": 0, "note": "Hook + map video" },
    { "tweet_number": 2, "text": "tweet text", "char_count": 0, "note": "Framing split" },
    { "tweet_number": 3, "text": "tweet text", "char_count": 0, "note": "Buried evidence" },
    { "tweet_number": 4, "text": "tweet text", "char_count": 0, "note": "Debate highlight" },
    { "tweet_number": 5, "text": "tweet text with overcurrent.news/story/SLUG", "char_count": 0, "note": "CTA" }
  ],
  "instagram": {
    "slide_1": "8 words max hook",
    "slide_2": "Framing split text with regional perspectives",
    "slide_3": "Buried evidence text",
    "slide_4": "Debate highlight text",
    "slide_5": "Every outlet shows you their version.\\nWe show you everyone's.\\novercurrent.news",
    "caption": "150-200 word caption ending with Link in bio.",
    "first_comment": "#medialiteracy #newsbias #factcheck #journalism #AI #mediabias #newsanalysis #media",
    "reel_caption": "Under 80 word caption for map video"
  },
  "reddit": [
    {
      "subreddit": "r/Artificial",
      "title": "title under 300 chars",
      "body": "200-400 word post"
    },
    {
      "subreddit": "r/media",
      "title": "title under 300 chars",
      "body": "200-400 word post"
    },
    {
      "subreddit": "r/relevant_topic_sub",
      "title": "title under 300 chars",
      "body": "200-400 word post"
    }
  ]
}`

interface TwitterTweet {
  tweet_number: number
  text: string
  char_count: number
  note: string
}

interface InstagramData {
  slide_1: string
  slide_2: string
  slide_3: string
  slide_4: string
  slide_5: string
  caption: string
  first_comment: string
  reel_caption: string
}

interface RedditPost {
  subreddit: string
  title: string
  body: string
}

interface SocialAgentResponse {
  twitter_thread: TwitterTweet[]
  instagram: InstagramData
  reddit: RedditPost[]
}

export async function generateSocialDrafts(
  analysisData: Record<string, unknown>,
  storyId?: string,
  undercurrentReportId?: string,
): Promise<DraftOutput[]> {
  const result = await callModel({
    provider: 'anthropic',
    tier: 'fast',
    system: SYSTEM_PROMPT,
    userMessage: `Generate social media content for this analysis:\n\n${JSON.stringify(analysisData, null, 2)}`,
    maxTokens: 8192,
    agentType: 'social_draft',
    storyId,
    undercurrentReportId,
  })

  const parsed = parseJSON<SocialAgentResponse>(result.text)
  const drafts: DraftOutput[] = []

  // Twitter thread (5 tweets)
  if (parsed.twitter_thread && Array.isArray(parsed.twitter_thread)) {
    const threadText = parsed.twitter_thread
      .map((t) => `[TWEET ${t.tweet_number}/5]\n${t.text}\n(${t.char_count} characters)`)
      .join('\n\n')

    drafts.push({
      platform: 'twitter_thread',
      content: threadText,
      metadata: {
        tweet_count: parsed.twitter_thread.length,
        tweets: parsed.twitter_thread,
      },
    })

    // Also save tweet 1 as a standalone hook
    if (parsed.twitter_thread[0]) {
      drafts.push({
        platform: 'twitter_hook',
        content: parsed.twitter_thread[0].text,
        metadata: { char_count: parsed.twitter_thread[0].char_count },
      })
    }
  }

  // Instagram carousel
  if (parsed.instagram) {
    const ig = parsed.instagram
    const slidesText = [
      `SLIDE 1: ${ig.slide_1}`,
      `\nSLIDE 2:\n${ig.slide_2}`,
      `\nSLIDE 3:\n${ig.slide_3}`,
      `\nSLIDE 4:\n${ig.slide_4}`,
      `\nSLIDE 5:\n${ig.slide_5}`,
    ].join('\n')

    drafts.push({
      platform: 'instagram_carousel',
      content: slidesText,
      metadata: {
        slides: [ig.slide_1, ig.slide_2, ig.slide_3, ig.slide_4, ig.slide_5],
        caption: ig.caption,
        first_comment: ig.first_comment,
        reel_caption: ig.reel_caption,
      },
    })

    // Caption as separate draft for easy copy
    drafts.push({
      platform: 'instagram_caption',
      content: ig.caption,
      metadata: { first_comment: ig.first_comment },
    })

    // Reel caption
    if (ig.reel_caption) {
      drafts.push({
        platform: 'instagram_reel',
        content: ig.reel_caption,
      })
    }
  }

  // Reddit (3 versions)
  if (parsed.reddit && Array.isArray(parsed.reddit)) {
    for (const post of parsed.reddit) {
      drafts.push({
        platform: 'reddit',
        content: `# ${post.title}\n\n${post.body}`,
        metadata: {
          title: post.title,
          subreddit: post.subreddit,
        },
      })
    }
  }

  return drafts
}
