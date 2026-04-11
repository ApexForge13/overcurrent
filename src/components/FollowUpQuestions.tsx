"use client";
import { useState } from "react";

interface FollowUpQuestion {
  question: string;
  hypotheses?: string[];
  evidence_status?: string;
}

interface FollowUpQuestionsProps {
  questions: FollowUpQuestion[];
}

export function FollowUpQuestions({ questions }: FollowUpQuestionsProps) {
  const [openIdx, setOpenIdx] = useState<number | null>(null);

  return (
    <div>
      {questions.map((q, i) => {
        const isOpen = openIdx === i;
        const hasDetail = (q.hypotheses && q.hypotheses.length > 0) || q.evidence_status;

        return (
          <div key={i} style={{ borderBottom: '1px solid var(--border-primary)' }}>
            <button
              onClick={() => hasDetail && setOpenIdx(isOpen ? null : i)}
              className="w-full text-left py-4 flex items-start gap-3"
              style={{ cursor: hasDetail ? 'pointer' : 'default' }}
            >
              <span style={{
                fontFamily: 'var(--font-mono)',
                fontSize: '12px',
                color: 'var(--text-tertiary)',
                flexShrink: 0,
                marginTop: '2px',
              }}>
                Q{i + 1}
              </span>
              <span style={{
                fontFamily: 'var(--font-body)',
                fontSize: '14px',
                color: 'var(--text-primary)',
                fontWeight: 500,
                flex: 1,
              }}>
                {q.question}
              </span>
              {hasDetail && (
                <span style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: '12px',
                  color: 'var(--text-tertiary)',
                  transform: isOpen ? 'rotate(90deg)' : 'rotate(0deg)',
                  transition: 'transform 200ms ease',
                  display: 'inline-block',
                }}>
                  ▸
                </span>
              )}
            </button>
            {isOpen && hasDetail && (
              <div className="pb-4 pl-8" style={{ animation: 'fadeIn 200ms ease' }}>
                {q.hypotheses && q.hypotheses.length > 0 && (
                  <ul className="space-y-1 mb-2">
                    {q.hypotheses.map((h, j) => (
                      <li key={j} style={{
                        fontFamily: 'var(--font-body)',
                        fontSize: '13px',
                        color: 'var(--text-secondary)',
                        paddingLeft: '12px',
                        position: 'relative',
                      }}>
                        <span style={{ position: 'absolute', left: 0, color: 'var(--text-tertiary)' }}>-</span>
                        {h}
                      </li>
                    ))}
                  </ul>
                )}
                {q.evidence_status && (
                  <p style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: '11px',
                    color: 'var(--text-tertiary)',
                    fontStyle: 'italic',
                  }}>
                    {q.evidence_status}
                  </p>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
