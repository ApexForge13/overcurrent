import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "OVERCURRENT — Global News Verification",
  description:
    "See what's under the surface. Cross-reference global news coverage, detect omissions, and surface what's being buried.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col bg-background text-foreground font-body">
        {/* ── Header ─────────────────────────────────────────── */}
        <header className="border-b border-border sticky top-0 z-50 bg-background/95 backdrop-blur-sm">
          <div className="max-w-6xl mx-auto px-4 py-4 flex items-center justify-between">
            <a href="/" className="flex items-center gap-3 group">
              <div className="flex flex-col">
                <div className="font-display font-black text-xl tracking-wide leading-none">
                  <span className="text-text-muted">OVER</span>
                  <span className="text-accent-green">CURRENT</span>
                </div>
                <div className="flex items-center gap-0 mt-1">
                  <div className="h-px w-8 bg-border" />
                  <svg
                    viewBox="0 0 40 8"
                    className="w-10 h-2 text-accent-purple"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                  >
                    <path d="M0 4 C5 0, 10 8, 15 4 C20 0, 25 8, 30 4 C35 0, 40 8, 40 4" />
                  </svg>
                  <div className="h-px w-8 bg-border" />
                </div>
                <span className="text-[9px] tracking-[0.3em] text-text-muted font-mono uppercase mt-0.5">
                  Global News Verification
                </span>
              </div>
            </a>

            <nav className="flex items-center gap-4">
              <a
                href="/costs"
                className="text-xs font-mono text-text-muted hover:text-text-secondary transition-colors"
              >
                COSTS
              </a>
            </nav>
          </div>
        </header>

        {/* ── Main ─────────────────────────────────────────── */}
        <main className="flex-1">{children}</main>

        {/* ── Footer ─────────────────────────────────────────── */}
        <footer className="border-t border-border mt-auto">
          <div className="max-w-6xl mx-auto px-4 py-6 flex flex-col md:flex-row items-center justify-between gap-2">
            <p className="text-xs text-text-muted font-mono">
              OVERCURRENT &mdash; The news under the news
            </p>
            <p className="text-xs text-text-muted font-mono">
              No tracking &middot; No cookies &middot; No ads
            </p>
          </div>
        </footer>
      </body>
    </html>
  );
}
