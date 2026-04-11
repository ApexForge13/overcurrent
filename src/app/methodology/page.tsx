export default function MethodologyPage() {
  return (
    <div
      style={{
        maxWidth: 720,
        margin: '0 auto',
        padding: '64px 24px 96px',
      }}
    >
      {/* Page title */}
      <h1
        style={{
          fontFamily: 'var(--font-display)',
          fontSize: 42,
          fontWeight: 700,
          color: 'var(--text-primary)',
          marginBottom: 12,
          letterSpacing: '-0.02em',
        }}
      >
        Methodology
      </h1>
      <p
        style={{
          fontFamily: 'var(--font-body)',
          fontSize: 17,
          color: 'var(--text-secondary)',
          lineHeight: 1.7,
          marginBottom: 64,
        }}
      >
        How Overcurrent works, what we get right, and what we get wrong.
      </p>

      {/* ── WHAT OVERCURRENT DOES ── */}
      <div className="section-rule">
        <span>WHAT OVERCURRENT DOES</span>
      </div>
      <p
        style={{
          fontFamily: 'var(--font-body)',
          fontSize: 16,
          color: 'var(--text-secondary)',
          lineHeight: 1.8,
          marginBottom: 48,
        }}
      >
        We analyze how news outlets around the world cover the same stories. We
        don&apos;t produce journalism. We don&apos;t claim to be unbiased. We
        are transparent.
      </p>

      {/* ── HOW ANALYSIS WORKS ── */}
      <div className="section-rule">
        <span>HOW ANALYSIS WORKS</span>
      </div>
      <p
        style={{
          fontFamily: 'var(--font-body)',
          fontSize: 16,
          color: 'var(--text-secondary)',
          lineHeight: 1.8,
          marginBottom: 24,
        }}
      >
        Every story goes through a six-stage pipeline before publication.
      </p>
      <ol
        style={{
          fontFamily: 'var(--font-body)',
          fontSize: 15,
          color: 'var(--text-secondary)',
          lineHeight: 1.9,
          paddingLeft: 24,
          marginBottom: 48,
        }}
      >
        {[
          'Gather sources from RSS feeds across 50+ countries.',
          'AI triage deduplicates and categorizes incoming articles.',
          'Four AI models independently analyze each region\u2019s coverage.',
          'Models cross-examine each other\u2019s findings.',
          'A moderator synthesizes the debate into a unified analysis.',
          'Human reviews and publishes.',
        ].map((step, i) => (
          <li key={i} style={{ marginBottom: 8 }}>
            <span
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 12,
                color: 'var(--accent-green)',
                marginRight: 8,
              }}
            >
              {String(i + 1).padStart(2, '0')}
            </span>
            {step}
          </li>
        ))}
      </ol>

      {/* ── THE AI DEBATE ── */}
      <div className="section-rule">
        <span>THE AI DEBATE</span>
      </div>
      <p
        style={{
          fontFamily: 'var(--font-body)',
          fontSize: 16,
          color: 'var(--text-secondary)',
          lineHeight: 1.8,
          marginBottom: 16,
        }}
      >
        Analysis is structured as a three-round debate between four models:
      </p>
      <div
        style={{
          display: 'flex',
          gap: 12,
          flexWrap: 'wrap',
          marginBottom: 24,
        }}
      >
        {[
          { name: 'Claude', color: 'var(--model-claude)' },
          { name: 'GPT-4o', color: 'var(--model-gpt)' },
          { name: 'Gemini', color: 'var(--model-gemini)' },
          { name: 'Grok', color: 'var(--model-grok)' },
        ].map((model) => (
          <span
            key={model.name}
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 12,
              fontWeight: 600,
              color: model.color,
              padding: '4px 10px',
              border: `1px solid ${model.color}`,
              borderRadius: 2,
            }}
          >
            {model.name}
          </span>
        ))}
      </div>
      <div
        style={{
          fontFamily: 'var(--font-body)',
          fontSize: 15,
          color: 'var(--text-secondary)',
          lineHeight: 1.9,
          marginBottom: 16,
        }}
      >
        <p style={{ marginBottom: 12 }}>
          <strong style={{ color: 'var(--text-primary)', fontWeight: 600 }}>
            Round 1 — Independent Analysis.
          </strong>{' '}
          Each model analyzes the source material separately. No model sees
          another&apos;s output.
        </p>
        <p style={{ marginBottom: 12 }}>
          <strong style={{ color: 'var(--text-primary)', fontWeight: 600 }}>
            Round 2 — Cross-Examination.
          </strong>{' '}
          Each model reviews the others&apos; analyses and challenges claims,
          flags disagreements, and identifies gaps.
        </p>
        <p style={{ marginBottom: 12 }}>
          <strong style={{ color: 'var(--text-primary)', fontWeight: 600 }}>
            Round 3 — Moderator Synthesis.
          </strong>{' '}
          A moderator model synthesizes the debate into a single coherent
          analysis, noting where models agreed and disagreed.
        </p>
      </div>
      <p
        style={{
          fontFamily: 'var(--font-body)',
          fontSize: 15,
          color: 'var(--text-secondary)',
          lineHeight: 1.8,
          marginBottom: 48,
        }}
      >
        Multi-model debate reduces the chance that any single model&apos;s
        biases, hallucinations, or blind spots survive into the final output.
        Disagreement is a feature, not a bug.
      </p>

      {/* ── CONFIDENCE SCORING ── */}
      <div className="section-rule">
        <span>CONFIDENCE SCORING</span>
      </div>
      <div style={{ marginBottom: 48 }}>
        {[
          {
            level: 'HIGH',
            color: 'var(--accent-green)',
            desc: 'Widely corroborated across multiple independent sources and models.',
          },
          {
            level: 'MEDIUM',
            color: 'var(--accent-amber)',
            desc: 'Reported by some sources, not contradicted.',
          },
          {
            level: 'LOW',
            color: 'var(--accent-red)',
            desc: 'Limited sourcing or significant disagreement.',
          },
          {
            level: 'DEVELOPING',
            color: 'var(--text-tertiary)',
            desc: 'Insufficient evidence to assess.',
          },
        ].map((item) => (
          <div
            key={item.level}
            style={{
              display: 'flex',
              alignItems: 'baseline',
              gap: 16,
              padding: '12px 0',
              borderBottom: '1px solid var(--border-primary)',
            }}
          >
            <span
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 12,
                fontWeight: 600,
                color: item.color,
                minWidth: 90,
              }}
            >
              {item.level}
            </span>
            <span
              style={{
                fontFamily: 'var(--font-body)',
                fontSize: 15,
                color: 'var(--text-secondary)',
              }}
            >
              {item.desc}
            </span>
          </div>
        ))}
      </div>

      {/* ── CONSENSUS SCORE ── */}
      <div className="section-rule">
        <span>CONSENSUS SCORE</span>
      </div>
      <p
        style={{
          fontFamily: 'var(--font-body)',
          fontSize: 16,
          color: 'var(--text-secondary)',
          lineHeight: 1.8,
          marginBottom: 16,
        }}
      >
        The consensus score is the percentage of outlets that agree on the core
        facts of a story.
      </p>
      <p
        style={{
          fontFamily: 'var(--font-body)',
          fontSize: 15,
          color: 'var(--text-secondary)',
          lineHeight: 1.8,
          padding: '16px 20px',
          borderLeft: '3px solid var(--accent-blue)',
          background: 'var(--bg-secondary)',
          marginBottom: 48,
        }}
      >
        Consensus does not equal truth. High consensus is notable, not proof.
      </p>

      {/* ── WHAT WE GET WRONG ── */}
      <div className="section-rule">
        <span>WHAT WE GET WRONG</span>
      </div>
      <p
        style={{
          fontFamily: 'var(--font-body)',
          fontSize: 16,
          color: 'var(--text-secondary)',
          lineHeight: 1.8,
          marginBottom: 16,
        }}
      >
        We could be wrong. Our AI models hallucinate. Our source coverage has
        gaps. We miss non-English coverage. We may mischaracterize outlet
        positions. Flag errors and we&apos;ll fix them.
      </p>
      <p
        style={{
          fontFamily: 'var(--font-body)',
          fontSize: 15,
          color: 'var(--text-tertiary)',
          lineHeight: 1.8,
          marginBottom: 48,
        }}
      >
        If you see something wrong, tell us. We will correct it publicly.
      </p>

      {/* ── WHAT WE ARE NOT ── */}
      <div className="section-rule">
        <span>WHAT WE ARE NOT</span>
      </div>
      <div style={{ marginBottom: 48 }}>
        {[
          'Not journalists.',
          'Not unbiased.',
          'Not infallible.',
          'Not a fact-checker.',
          'Coverage analysts.',
        ].map((item, i) => (
          <div
            key={i}
            style={{
              fontFamily: 'var(--font-body)',
              fontSize: 16,
              color:
                i === 4 ? 'var(--text-primary)' : 'var(--text-secondary)',
              fontWeight: i === 4 ? 600 : 400,
              padding: '10px 0',
              borderBottom: '1px solid var(--border-primary)',
            }}
          >
            <span
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 12,
                color: 'var(--text-tertiary)',
                marginRight: 12,
              }}
            >
              {i === 4 ? '\u2713' : '\u2717'}
            </span>
            {item}
          </div>
        ))}
      </div>
    </div>
  )
}
