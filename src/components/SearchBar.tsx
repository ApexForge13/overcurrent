"use client";

import { useState } from "react";

interface SearchBarProps {
  mode: "verify" | "undercurrent";
  onSubmit: (query: string) => void;
  isLoading: boolean;
}

export function SearchBar({ mode, onSubmit, isLoading }: SearchBarProps) {
  const [query, setQuery] = useState("");

  const placeholder =
    mode === "verify"
      ? "Enter a story to verify..."
      : "Enter the dominant story everyone's talking about...";

  const accentColor = mode === "verify" ? "#22c55e" : "#a855f7";

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (query.trim() && !isLoading) {
      onSubmit(query.trim());
    }
  };

  return (
    <form onSubmit={handleSubmit} className="w-full">
      <div className="flex gap-3">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={placeholder}
          disabled={isLoading}
          className="flex-1 bg-[#111111] border border-[#1e1e1e] rounded-lg px-5 py-4 text-lg text-[#e5e5e5] placeholder-[#737373] focus:outline-none focus:border-[#333] transition-colors disabled:opacity-50"
          style={{ fontFamily: "IBM Plex Sans, sans-serif" }}
        />
        <button
          type="submit"
          disabled={isLoading || !query.trim()}
          className="px-8 py-4 rounded-lg text-black font-semibold text-lg transition-opacity disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed"
          style={{
            backgroundColor: accentColor,
            fontFamily: "IBM Plex Sans, sans-serif",
          }}
        >
          {isLoading ? (
            <span className="flex items-center gap-2">
              <svg
                className="animate-spin h-5 w-5"
                viewBox="0 0 24 24"
                fill="none"
              >
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                />
              </svg>
              Analyzing
            </span>
          ) : (
            "Analyze"
          )}
        </button>
      </div>
    </form>
  );
}
