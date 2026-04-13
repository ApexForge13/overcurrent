"use client"

import { useState } from "react"
import { AuthNav } from "./AuthNav"

export function MobileNav() {
  const [open, setOpen] = useState(false)

  return (
    <>
      {/* Desktop nav — hidden on mobile */}
      <div className="hidden sm:flex items-center gap-6">
        <a href="/methodology" className="hover:opacity-80 transition-opacity" style={{ color: 'var(--text-tertiary)', fontFamily: 'var(--font-body)', fontSize: '14px' }}>methodology</a>
        <a href="/outlets" className="hover:opacity-80 transition-opacity" style={{ color: 'var(--text-tertiary)', fontFamily: 'var(--font-body)', fontSize: '14px' }}>outlets</a>
        <AuthNav />
      </div>

      {/* Mobile hamburger — visible on small screens */}
      <button
        className="sm:hidden"
        onClick={() => setOpen(!open)}
        aria-label="Toggle menu"
        style={{
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          padding: '8px',
          display: 'flex',
          flexDirection: 'column',
          gap: '4px',
        }}
      >
        <span style={{
          display: 'block', width: '20px', height: '2px',
          background: 'var(--text-primary)',
          transform: open ? 'rotate(45deg) translateY(6px)' : 'none',
          transition: 'transform 0.2s',
        }} />
        <span style={{
          display: 'block', width: '20px', height: '2px',
          background: 'var(--text-primary)',
          opacity: open ? 0 : 1,
          transition: 'opacity 0.2s',
        }} />
        <span style={{
          display: 'block', width: '20px', height: '2px',
          background: 'var(--text-primary)',
          transform: open ? 'rotate(-45deg) translateY(-6px)' : 'none',
          transition: 'transform 0.2s',
        }} />
      </button>

      {/* Mobile dropdown */}
      {open && (
        <div
          className="sm:hidden"
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            right: 0,
            background: 'var(--bg-primary)',
            borderBottom: '1px solid var(--border-primary)',
            padding: '16px 24px',
            display: 'flex',
            flexDirection: 'column',
            gap: '16px',
            zIndex: 100,
          }}
        >
          <a
            href="/methodology"
            onClick={() => setOpen(false)}
            style={{ fontFamily: 'var(--font-body)', fontSize: '15px', color: 'var(--text-secondary)', textDecoration: 'none' }}
          >
            methodology
          </a>
          <a
            href="/outlets"
            onClick={() => setOpen(false)}
            style={{ fontFamily: 'var(--font-body)', fontSize: '15px', color: 'var(--text-secondary)', textDecoration: 'none' }}
          >
            outlets
          </a>
          <a
            href="/suggest"
            onClick={() => setOpen(false)}
            style={{ fontFamily: 'var(--font-body)', fontSize: '15px', color: 'var(--text-secondary)', textDecoration: 'none' }}
          >
            suggest a story
          </a>
          <div style={{ borderTop: '1px solid var(--border-primary)', paddingTop: '16px' }}>
            <AuthNav />
          </div>
        </div>
      )}
    </>
  )
}
