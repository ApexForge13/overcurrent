'use client'

import { useState } from 'react'

export function SuggestForm() {
  const [topic, setTopic] = useState('')
  const [description, setDescription] = useState('')
  const [email, setEmail] = useState('')
  const [status, setStatus] = useState<'idle' | 'submitting' | 'success' | 'error'>('idle')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!topic.trim()) return

    setStatus('submitting')
    try {
      const res = await fetch('/api/suggest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          topic: topic.trim(),
          description: description.trim() || undefined,
          email: email.trim() || undefined,
        }),
      })
      if (!res.ok) throw new Error('Request failed')
      setStatus('success')
      setTopic('')
      setDescription('')
      setEmail('')
    } catch {
      setStatus('error')
    }
  }

  if (status === 'success') {
    return (
      <div
        style={{
          padding: '32px 24px',
          border: '1px solid var(--accent-green)',
          background: 'var(--bg-secondary)',
        }}
      >
        <p
          style={{
            fontFamily: 'var(--font-body)',
            fontSize: 16,
            color: 'var(--accent-green)',
            fontWeight: 600,
            marginBottom: 8,
          }}
        >
          Suggestion received.
        </p>
        <p
          style={{
            fontFamily: 'var(--font-body)',
            fontSize: 14,
            color: 'var(--text-secondary)',
          }}
        >
          We review suggestions regularly. No guarantees on timing or coverage.
        </p>
        <button
          onClick={() => setStatus('idle')}
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 12,
            color: 'var(--text-tertiary)',
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            marginTop: 16,
            textDecoration: 'underline',
            textUnderlineOffset: 2,
          }}
        >
          Submit another
        </button>
      </div>
    )
  }

  const inputStyle: React.CSSProperties = {
    fontFamily: 'var(--font-body)',
    fontSize: 14,
    color: 'var(--text-primary)',
    background: 'var(--bg-secondary)',
    border: '1px solid var(--border-primary)',
    padding: '10px 14px',
    width: '100%',
    outline: 'none',
  }

  const labelStyle: React.CSSProperties = {
    fontFamily: 'var(--font-mono)',
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
    color: 'var(--text-tertiary)',
    display: 'block',
    marginBottom: 8,
  }

  return (
    <form onSubmit={handleSubmit}>
      {/* Topic */}
      <div style={{ marginBottom: 24 }}>
        <label style={labelStyle}>
          Topic <span style={{ color: 'var(--accent-red)' }}>*</span>
        </label>
        <input
          type="text"
          required
          placeholder="e.g. South China Sea tensions"
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          style={inputStyle}
        />
      </div>

      {/* Description */}
      <div style={{ marginBottom: 24 }}>
        <label style={labelStyle}>Description</label>
        <textarea
          placeholder="Why is this story interesting? Any specific angles to look at?"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={4}
          style={{ ...inputStyle, resize: 'vertical' as const }}
        />
      </div>

      {/* Email */}
      <div style={{ marginBottom: 32 }}>
        <label style={labelStyle}>Email</label>
        <input
          type="email"
          placeholder="For follow-up only"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          style={inputStyle}
        />
        <p
          style={{
            fontFamily: 'var(--font-body)',
            fontSize: 12,
            color: 'var(--text-tertiary)',
            marginTop: 6,
          }}
        >
          Optional. We will never share your email.
        </p>
      </div>

      {/* Error */}
      {status === 'error' && (
        <p
          style={{
            fontFamily: 'var(--font-body)',
            fontSize: 14,
            color: 'var(--accent-red)',
            marginBottom: 16,
          }}
        >
          Something went wrong. Please try again.
        </p>
      )}

      {/* Submit */}
      <button
        type="submit"
        disabled={status === 'submitting'}
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 13,
          fontWeight: 600,
          letterSpacing: '0.04em',
          textTransform: 'uppercase',
          color: 'var(--bg-primary)',
          background: 'var(--text-primary)',
          border: 'none',
          padding: '12px 32px',
          cursor: status === 'submitting' ? 'wait' : 'pointer',
          opacity: status === 'submitting' ? 0.6 : 1,
        }}
      >
        {status === 'submitting' ? 'Submitting...' : 'Submit Suggestion'}
      </button>
    </form>
  )
}
