"use client";
import { useState } from "react";

interface ErrorFlagButtonProps {
  storyId?: string;
  undercurrentReportId?: string;
}

export function ErrorFlagButton({ storyId, undercurrentReportId }: ErrorFlagButtonProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [errorType, setErrorType] = useState("factual_error");
  const [description, setDescription] = useState("");
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!description.trim()) return;
    setSubmitting(true);
    try {
      await fetch("/api/errors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storyId, undercurrentReportId, errorType, description: description.trim(), submitterEmail: email.trim() || undefined }),
      });
      setSubmitted(true);
    } catch { /* silent */ }
    setSubmitting(false);
  }

  if (submitted) {
    return (
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: '12px', color: 'var(--accent-green)' }}>
        Error flagged. Thank you.
      </span>
    );
  }

  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: '12px',
          color: 'var(--text-tertiary)',
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          padding: 0,
          textDecoration: 'underline',
          textUnderlineOffset: '2px',
        }}
      >
        Flag an error
      </button>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="mt-4 space-y-3" style={{ maxWidth: '480px' }}>
      <select
        value={errorType}
        onChange={(e) => setErrorType(e.target.value)}
        style={{
          width: '100%',
          padding: '6px 8px',
          fontFamily: 'var(--font-mono)',
          fontSize: '12px',
          background: 'var(--bg-secondary)',
          color: 'var(--text-primary)',
          border: '1px solid var(--border-primary)',
        }}
      >
        <option value="factual_error">Factual error</option>
        <option value="missing_source">Missing source</option>
        <option value="mischaracterized_outlet">Mischaracterized outlet</option>
        <option value="other">Other</option>
      </select>
      <textarea
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="What did we get wrong?"
        required
        rows={3}
        style={{
          width: '100%',
          padding: '8px',
          fontFamily: 'var(--font-body)',
          fontSize: '13px',
          background: 'var(--bg-secondary)',
          color: 'var(--text-primary)',
          border: '1px solid var(--border-primary)',
          resize: 'vertical',
        }}
      />
      <input
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="Email (optional, for follow-up)"
        style={{
          width: '100%',
          padding: '6px 8px',
          fontFamily: 'var(--font-body)',
          fontSize: '13px',
          background: 'var(--bg-secondary)',
          color: 'var(--text-primary)',
          border: '1px solid var(--border-primary)',
        }}
      />
      <div className="flex gap-3">
        <button
          type="submit"
          disabled={submitting || !description.trim()}
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: '12px',
            padding: '6px 12px',
            color: 'var(--text-primary)',
            border: '1px solid var(--border-primary)',
            background: 'transparent',
            cursor: submitting ? 'wait' : 'pointer',
            opacity: submitting ? 0.5 : 1,
          }}
        >
          {submitting ? 'submitting...' : 'submit flag'}
        </button>
        <button
          type="button"
          onClick={() => setIsOpen(false)}
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: '12px',
            color: 'var(--text-tertiary)',
            background: 'none',
            border: 'none',
            cursor: 'pointer',
          }}
        >
          cancel
        </button>
      </div>
    </form>
  );
}
