"use client";

import { useState } from "react";

interface Source {
  url: string;
  title: string;
  outlet: string;
  outletType: string;
  country: string;
  region: string;
  politicalLean: string;
  reliability: string;
}

interface SourcesListProps {
  sources: Source[];
}

const LEAN_STYLES: Record<string, string> = {
  left: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  "center-left": "bg-sky-500/10 text-sky-400 border-sky-500/20",
  center: "bg-gray-500/10 text-gray-400 border-gray-500/20",
  "center-right": "bg-orange-500/10 text-orange-400 border-orange-500/20",
  right: "bg-red-500/10 text-red-400 border-red-500/20",
};

const RELIABILITY_STYLES: Record<string, string> = {
  high: "bg-green-500/10 text-green-400 border-green-500/20",
  medium: "bg-amber-500/10 text-amber-400 border-amber-500/20",
  low: "bg-red-500/10 text-red-400 border-red-500/20",
  mixed: "bg-orange-500/10 text-orange-400 border-orange-500/20",
};

const COUNTRY_FLAGS: Record<string, string> = {
  US: "\u{1F1FA}\u{1F1F8}", UK: "\u{1F1EC}\u{1F1E7}", CA: "\u{1F1E8}\u{1F1E6}",
  AU: "\u{1F1E6}\u{1F1FA}", DE: "\u{1F1E9}\u{1F1EA}", FR: "\u{1F1EB}\u{1F1F7}",
  JP: "\u{1F1EF}\u{1F1F5}", CN: "\u{1F1E8}\u{1F1F3}", IN: "\u{1F1EE}\u{1F1F3}",
  BR: "\u{1F1E7}\u{1F1F7}", RU: "\u{1F1F7}\u{1F1FA}", IL: "\u{1F1EE}\u{1F1F1}",
  SA: "\u{1F1F8}\u{1F1E6}", QA: "\u{1F1F6}\u{1F1E6}", AE: "\u{1F1E6}\u{1F1EA}",
  KR: "\u{1F1F0}\u{1F1F7}", SG: "\u{1F1F8}\u{1F1EC}", ZA: "\u{1F1FF}\u{1F1E6}",
  NG: "\u{1F1F3}\u{1F1EC}", KE: "\u{1F1F0}\u{1F1EA}", MX: "\u{1F1F2}\u{1F1FD}",
};

function getFlag(country: string): string {
  return COUNTRY_FLAGS[country] || "\u{1F30D}";
}

export function SourcesList({ sources }: SourcesListProps) {
  const [isOpen, setIsOpen] = useState(false);

  const grouped = sources.reduce<Record<string, Source[]>>((acc, source) => {
    const region = source.region || "Unknown";
    if (!acc[region]) acc[region] = [];
    acc[region].push(source);
    return acc;
  }, {});

  return (
    <div className="border border-[#1e1e1e] rounded-lg overflow-hidden">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between px-5 py-3 bg-[#111111] hover:bg-[#141414] transition-colors cursor-pointer"
        style={{ fontFamily: "IBM Plex Sans, sans-serif" }}
      >
        <span className="text-sm text-[#a3a3a3]">
          {isOpen ? "Hide" : "Show"} {sources.length} sources
        </span>
        <svg
          className={`h-4 w-4 text-[#737373] transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {isOpen && (
        <div className="bg-[#0d0d0d] divide-y divide-[#1e1e1e]">
          {Object.entries(grouped).map(([region, regionSources]) => (
            <div key={region} className="p-4">
              <h4
                className="text-xs font-bold uppercase tracking-wider text-[#737373] mb-3"
                style={{ fontFamily: "IBM Plex Sans, sans-serif" }}
              >
                {region}
              </h4>
              <div className="space-y-2">
                {regionSources.map((source, i) => (
                  <div key={i} className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm">{getFlag(source.country)}</span>
                    <span
                      className="text-sm text-[#e5e5e5]"
                      style={{ fontFamily: "IBM Plex Sans, sans-serif" }}
                    >
                      {source.outlet}
                    </span>
                    {source.politicalLean && (
                      <span
                        className={`text-[10px] px-1.5 py-0.5 rounded border ${LEAN_STYLES[source.politicalLean] || LEAN_STYLES.center}`}
                        style={{ fontFamily: "IBM Plex Sans, sans-serif" }}
                      >
                        {source.politicalLean}
                      </span>
                    )}
                    {source.reliability && (
                      <span
                        className={`text-[10px] px-1.5 py-0.5 rounded border ${RELIABILITY_STYLES[source.reliability] || RELIABILITY_STYLES.medium}`}
                        style={{ fontFamily: "IBM Plex Sans, sans-serif" }}
                      >
                        {source.reliability}
                      </span>
                    )}
                    <a
                      href={source.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-[#737373] hover:text-[#a3a3a3] transition-colors ml-auto"
                      style={{ fontFamily: "JetBrains Mono, monospace" }}
                    >
                      link &rarr;
                    </a>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
