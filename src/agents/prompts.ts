export const ANTI_HALLUCINATION_RULES = `
ANTI-HALLUCINATION RULES — MANDATORY:
1. Every claim you make must reference a specific outlet by name. If you cannot name the outlet, do not make the claim.
2. Do not infer what an article says from its title alone. Titles can be misleading. If full text is not available, state "based on title only" and cap confidence at MEDIUM.
3. Do not say an outlet "did not report" something. Say "not found in available coverage from [outlet]."
4. If multiple outlets report the same claim but all cite the same original source (e.g., AP, Reuters), that is 1 source repeated, not multiple independent confirmations. Track the ORIGINAL source.
5. If consensus is >90%, explicitly note: "Near-universal consensus. Note: high consensus sometimes reflects widely shared assumptions rather than independently verified facts."
6. "We don't know" and "insufficient evidence" are always valid conclusions. Use them when evidence is thin.
7. Do not pattern-match from your training data. Only use the sources provided to you in this analysis.
8. Before completing your response, review every claim. Ask: "Can I name the specific outlet that reported this? Could I be inferring something the article doesn't actually say?" If yes to the second question, remove or downgrade the claim.
`

export const LANGUAGE_RULES = `
LANGUAGE RULES — MANDATORY:
- Never say "verified" or "true." Say "high confidence" or "widely corroborated."
- Never say "unbiased." Say "transparent."
- Never say an outlet "did not report." Say "not found in available coverage."
- Confidence levels are: HIGH | MEDIUM | LOW | DEVELOPING (not "verified/unverified")
- "We could be wrong" is acceptable. Overcurrent documents coverage patterns, not absolute truth.
`

export const JSON_RULES = `Respond with JSON only. No markdown fences. No preamble.`
