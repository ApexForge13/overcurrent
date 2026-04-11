"use client";
import { useState } from "react";

export function NewsletterSignup() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setStatus("loading");

    try {
      const res = await fetch("/api/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });
      if (res.ok) {
        setStatus("success");
        setEmail("");
      } else {
        setStatus("error");
      }
    } catch {
      setStatus("error");
    }
  }

  if (status === "success") {
    return (
      <p style={{ fontFamily: 'var(--font-mono)', fontSize: '12px', color: 'var(--accent-green)' }}>
        Subscribed. Weekly digest incoming.
      </p>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex gap-2">
      <input
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="your@email.com"
        required
        style={{
          flex: 1,
          padding: '8px 12px',
          fontFamily: 'var(--font-body)',
          fontSize: '13px',
          background: 'var(--bg-secondary)',
          color: 'var(--text-primary)',
          border: '1px solid var(--border-primary)',
          outline: 'none',
          maxWidth: '240px',
        }}
      />
      <button
        type="submit"
        disabled={status === "loading"}
        style={{
          padding: '8px 16px',
          fontFamily: 'var(--font-mono)',
          fontSize: '12px',
          color: 'var(--text-primary)',
          background: 'transparent',
          border: '1px solid var(--border-primary)',
          cursor: status === "loading" ? 'wait' : 'pointer',
          opacity: status === "loading" ? 0.5 : 1,
        }}
      >
        {status === "loading" ? "..." : "subscribe"}
      </button>
      {status === "error" && (
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--accent-red)', alignSelf: 'center' }}>
          failed
        </span>
      )}
    </form>
  );
}
