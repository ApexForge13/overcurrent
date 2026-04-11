"use client";

import Link from "next/link";
import { useEffect } from "react";
import { ConfidenceBadge } from "./ConfidenceBadge";
import { CostDisplay } from "./CostDisplay";

interface StoryCardProps {
  story: {
    slug: string;
    headline: string;
    synopsis: string;
    confidenceLevel: string;
    sourceCount: number;
    countryCount: number;
    regionCount: number;
    consensusScore: number;
    totalCost: number;
    createdAt: string;
  };
  index?: number;
}

const KEYFRAMES = `
@keyframes sc-breathe {
  0%, 100% { transform: translateY(0); }
  50%      { transform: translateY(-4px); }
}
@keyframes sc-badgePulse {
  0%, 100% { opacity: 1; }
  50%      { opacity: 0.7; }
}
@keyframes sc-shine {
  0%   { left: -75%; }
  20%  { left: 125%; }
  100% { left: 125%; }
}
`;

let keyframesInjected = false;
function ensureKeyframes() {
  if (typeof document === "undefined" || keyframesInjected) return;
  const style = document.createElement("style");
  style.textContent = KEYFRAMES;
  document.head.appendChild(style);
  keyframesInjected = true;
}

export function StoryCard({ story, index = 0 }: StoryCardProps) {
  useEffect(() => {
    ensureKeyframes();
  }, []);

  const date = new Date(story.createdAt).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  const staggerDelay = index * 0.8;

  return (
    <Link href={`/story/${story.slug}`} className="block group">
      <article
        className="relative overflow-hidden bg-[#111111] border border-[#1e1e1e] rounded-lg p-5 transition-all duration-300 ease-out hover:border-[#22c55e44] hover:bg-[#131313]"
        style={{
          animation: `sc-breathe 6s ease-in-out ${staggerDelay}s infinite`,
        }}
        onMouseEnter={(e) => {
          const el = e.currentTarget;
          el.style.transform = "translateY(-6px)";
          el.style.boxShadow = "0 12px 32px rgba(0,0,0,0.4), 0 0 20px rgba(34,197,94,0.08)";
          el.style.animationPlayState = "paused";
        }}
        onMouseLeave={(e) => {
          const el = e.currentTarget;
          el.style.transform = "";
          el.style.boxShadow = "";
          el.style.animationPlayState = "running";
        }}
      >
        {/* Gradient shine sweep */}
        <div
          className="absolute top-0 h-full w-3/4 pointer-events-none"
          style={{
            background:
              "linear-gradient(90deg, transparent, rgba(255,255,255,0.03), transparent)",
            animation: `sc-shine 8s ${staggerDelay + 2}s ease-in-out infinite`,
            left: "-75%",
          }}
        />

        <div className="relative z-10">
          <div className="flex items-start justify-between gap-3 mb-3">
            <div style={{ animation: "sc-badgePulse 4s ease-in-out infinite" }}>
              <ConfidenceBadge level={story.confidenceLevel} />
            </div>
            <span
              className="text-xs text-[#737373]"
              style={{ fontFamily: "JetBrains Mono, monospace" }}
            >
              {date}
            </span>
          </div>

          <h3
            className="text-lg font-semibold text-[#e5e5e5] mb-2 group-hover:text-white transition-colors duration-300"
            style={{ fontFamily: "Playfair Display, serif" }}
          >
            {story.headline}
          </h3>

          <p
            className="text-sm text-[#a3a3a3] mb-4 line-clamp-2"
            style={{ fontFamily: "IBM Plex Sans, sans-serif" }}
          >
            {story.synopsis}
          </p>

          <div className="flex items-center justify-between">
            <span
              className="text-xs text-[#737373]"
              style={{ fontFamily: "IBM Plex Sans, sans-serif" }}
            >
              {story.sourceCount} sources &middot; {story.countryCount} countries &middot;{" "}
              {story.regionCount} regions
            </span>
            <CostDisplay cost={story.totalCost} />
          </div>
        </div>
      </article>
    </Link>
  );
}
