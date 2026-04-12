import type { Metadata } from "next";
import { AuthNav } from "@/components/AuthNav";
import { NewsletterSignup } from "@/components/NewsletterSignup";
import "./globals.css";

export const metadata: Metadata = {
  title: "OVERCURRENT",
  description: "Every outlet shows you their version. We show you everyone's. Cross-reference global news coverage across 50+ countries using 4 AI models.",
  icons: {
    icon: [
      { url: '/favicon.svg', type: 'image/svg+xml' },
      { url: '/favicon-32x32.png', sizes: '32x32', type: 'image/png' },
      { url: '/favicon-16x16.png', sizes: '16x16', type: 'image/png' },
    ],
    apple: '/apple-touch-icon.png',
  },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className="antialiased">
      <body className="min-h-screen flex flex-col">
        {/* Navigation */}
        <header className="sticky top-0 z-50 border-b" style={{ borderColor: 'var(--border-primary)', background: 'var(--bg-primary)' }}>
          <nav className="max-w-[1200px] mx-auto px-4 sm:px-6 min-h-[56px] py-2 flex items-center justify-between flex-wrap gap-2">
            <a href="/" className="flex items-center">
              <img src="/logo.svg" alt="OVERCURRENT" style={{ height: '28px' }} />
            </a>
            <div className="flex items-center gap-3 sm:gap-6">
              <a href="/methodology" className="text-xs sm:text-sm hover:opacity-80 transition-opacity" style={{ color: 'var(--text-tertiary)', fontFamily: 'var(--font-body)' }}>methodology</a>
              <a href="/outlets" className="text-xs sm:text-sm hover:opacity-80 transition-opacity" style={{ color: 'var(--text-tertiary)', fontFamily: 'var(--font-body)' }}>outlets</a>
              <AuthNav />
            </div>
          </nav>
        </header>

        {/* Content */}
        <main className="flex-1">{children}</main>

        {/* Footer */}
        <footer className="border-t py-8" style={{ borderColor: 'var(--border-primary)' }}>
          <div className="max-w-[1200px] mx-auto px-4 sm:px-6">
            <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
              <div className="flex flex-wrap items-center gap-4 sm:gap-6">
                <a href="/methodology" style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--text-tertiary)', textDecoration: 'none' }} className="hover:opacity-80">methodology</a>
                <a href="/outlets" style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--text-tertiary)', textDecoration: 'none' }} className="hover:opacity-80">outlets</a>
                <a href="/suggest" style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--text-tertiary)', textDecoration: 'none' }} className="hover:opacity-80">suggest a story</a>
                <a href="mailto:hello@overcurrent.news" style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--text-tertiary)', textDecoration: 'none' }} className="hover:opacity-80">contact</a>
              </div>
              <NewsletterSignup />
            </div>
            <div className="mt-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2">
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'var(--text-tertiary)' }}>
                OVERCURRENT — Coverage analysis, not journalism.
              </span>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'var(--text-tertiary)' }}>
                No tracking. No cookies. No ads.
              </span>
            </div>
          </div>
        </footer>
      </body>
    </html>
  );
}
