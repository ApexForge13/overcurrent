import type { Metadata } from "next";
import { AuthNav } from "@/components/AuthNav";
import "./globals.css";

export const metadata: Metadata = {
  title: "OVERCURRENT",
  description: "See what's under the surface. Cross-reference global news coverage across 50+ countries using 4 AI models.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className="antialiased">
      <body className="min-h-screen flex flex-col">
        {/* Navigation */}
        <header className="sticky top-0 z-50 border-b" style={{ borderColor: 'var(--border-primary)', background: 'var(--bg-primary)' }}>
          <nav className="max-w-[1200px] mx-auto px-6 h-14 flex items-center justify-between">
            <a href="/" className="flex items-baseline gap-1">
              <span style={{ fontFamily: 'var(--font-display)', fontSize: '18px', fontWeight: 700, letterSpacing: '0.06em', color: 'var(--text-primary)' }}>
                OVERCURRENT
              </span>
            </a>
            <div className="flex items-center gap-6">
              <a href="/methodology" className="text-sm hover:opacity-80 transition-opacity" style={{ color: 'var(--text-tertiary)', fontFamily: 'var(--font-body)' }}>methodology</a>
              <a href="/outlets" className="text-sm hover:opacity-80 transition-opacity" style={{ color: 'var(--text-tertiary)', fontFamily: 'var(--font-body)' }}>outlets</a>
              <a href="/costs" className="text-sm hover:opacity-80 transition-opacity" style={{ color: 'var(--text-tertiary)', fontFamily: 'var(--font-body)' }}>costs</a>
              <a href="/admin" className="text-sm hover:opacity-80 transition-opacity" style={{ color: 'var(--text-tertiary)', fontFamily: 'var(--font-body)' }}>admin</a>
              <AuthNav />
            </div>
          </nav>
        </header>

        {/* Content */}
        <main className="flex-1">{children}</main>

        {/* Footer — minimal */}
        <footer className="border-t py-8" style={{ borderColor: 'var(--border-primary)' }}>
          <div className="max-w-[1200px] mx-auto px-6 flex items-center justify-between">
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: '12px', color: 'var(--text-tertiary)' }}>
              OVERCURRENT — Coverage analysis, not journalism.
            </span>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: '12px', color: 'var(--text-tertiary)' }}>
              No tracking. No cookies. No ads.
            </span>
          </div>
        </footer>
      </body>
    </html>
  );
}
