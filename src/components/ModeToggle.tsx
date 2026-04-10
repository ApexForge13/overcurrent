"use client";

interface ModeToggleProps {
  mode: "verify" | "undercurrent";
  onToggle: (mode: "verify" | "undercurrent") => void;
}

export function ModeToggle({ mode, onToggle }: ModeToggleProps) {
  return (
    <div className="relative inline-flex rounded-full bg-[#1e1e1e] p-1">
      {/* Sliding pill background */}
      <div
        className="absolute top-1 bottom-1 rounded-full transition-all duration-300 ease-in-out"
        style={{
          left: mode === "verify" ? "4px" : "50%",
          width: "calc(50% - 4px)",
          backgroundColor: mode === "verify" ? "#22c55e" : "#a855f7",
        }}
      />

      <button
        onClick={() => onToggle("verify")}
        className={`relative z-10 px-6 py-2 rounded-full text-sm font-semibold transition-colors duration-300 cursor-pointer ${
          mode === "verify" ? "text-black" : "text-[#a3a3a3] hover:text-[#e5e5e5]"
        }`}
        style={{ fontFamily: "IBM Plex Sans, sans-serif" }}
      >
        VERIFY
      </button>

      <button
        onClick={() => onToggle("undercurrent")}
        className={`relative z-10 px-6 py-2 rounded-full text-sm font-semibold transition-colors duration-300 cursor-pointer ${
          mode === "undercurrent" ? "text-black" : "text-[#a3a3a3] hover:text-[#e5e5e5]"
        }`}
        style={{ fontFamily: "IBM Plex Sans, sans-serif" }}
      >
        UNDERCURRENT
      </button>
    </div>
  );
}
