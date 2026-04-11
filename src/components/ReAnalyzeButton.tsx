"use client";
import { useState } from "react";

interface ReAnalyzeButtonProps {
  query: string;
  storySlug: string;
}

export function ReAnalyzeButton({ query, storySlug }: ReAnalyzeButtonProps) {
  const [isRunning, setIsRunning] = useState(false);
  const [done, setDone] = useState(false);

  async function handleReAnalyze() {
    if (isRunning) return;
    setIsRunning(true);

    try {
      const response = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query }),
      });

      if (!response.body) throw new Error("No stream");

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done: streamDone, value } = await reader.read();
        if (streamDone) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          if (line.startsWith("data: ")) {
            try {
              const data = JSON.parse(line.slice(6));
              if (data.phase === "complete" && data.slug) {
                setDone(true);
                setIsRunning(false);
                // Redirect to new story
                window.location.href = `/story/${data.slug}`;
                return;
              }
            } catch { /* skip */ }
          }
        }
      }
    } catch {
      setIsRunning(false);
    }
  }

  if (done) return null;

  return (
    <button
      onClick={handleReAnalyze}
      disabled={isRunning}
      style={{
        fontFamily: 'var(--font-mono)',
        fontSize: '11px',
        color: isRunning ? 'var(--text-tertiary)' : 'var(--accent-green)',
        background: 'none',
        border: '1px solid var(--border-primary)',
        padding: '4px 10px',
        cursor: isRunning ? 'wait' : 'pointer',
        opacity: isRunning ? 0.5 : 1,
      }}
    >
      {isRunning ? 'analyzing...' : 're-analyze'}
    </button>
  );
}
