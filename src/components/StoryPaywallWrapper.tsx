"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { recordLocalRead, getAccessTier, remainingFreeReads, ANON_FREE_READS, SIGNUP_FREE_READS } from "@/lib/paywall";
import { Paywall } from "./Paywall";
import { ReadCounter } from "./ReadCounter";

interface StoryPaywallWrapperProps {
  slug: string;
  children: React.ReactNode;
}

export function StoryPaywallWrapper({ slug, children }: StoryPaywallWrapperProps) {
  const [readCount, setReadCount] = useState(0);
  const [isAdmin, setIsAdmin] = useState(false);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    async function checkAuth() {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();

      if (user) {
        setIsLoggedIn(true);
        // Check if admin
        if (user.email === 'connermhecht13@gmail.com') {
          setIsAdmin(true);
        }
        // Check if subscribed (stored in user_metadata)
        if (user.user_metadata?.subscribed) {
          setIsSubscribed(true);
        }
        // Use user_metadata for read tracking if logged in
        const userReads: string[] = user.user_metadata?.reads || [];
        if (!userReads.includes(slug)) {
          const updated = [...userReads, slug];
          await supabase.auth.updateUser({ data: { reads: updated } });
          setReadCount(updated.length);
        } else {
          setReadCount(userReads.length);
        }
      } else {
        // Anonymous: use localStorage
        const count = recordLocalRead(slug);
        setReadCount(count);
      }

      setLoaded(true);
    }

    checkAuth();
  }, [slug]);

  // Show content immediately while loading (prevents flash of blank page)
  if (!loaded) return <>{children}</>;

  // Admin and subscribers always see full content
  if (isAdmin || isSubscribed) return <>{children}</>;

  const tier = getAccessTier(readCount, isLoggedIn);
  const remaining = remainingFreeReads(readCount, isLoggedIn);
  const limit = isLoggedIn ? SIGNUP_FREE_READS : ANON_FREE_READS;

  // ── TIER 1: FREE (reads 1-3 anon, 1-5 logged in) ──
  if (tier === 'free') {
    return (
      <>
        <ReadCounter remaining={remaining} total={limit} />
        {children}
      </>
    );
  }

  // ── TIER 2: SIGNUP WALL (anon, reads 4+) ──
  if (tier === 'signup_wall') {
    return (
      <div style={{ position: 'relative' }}>
        {/* Show first ~500px of content as teaser */}
        <div style={{ maxHeight: '500px', overflow: 'hidden' }}>
          {children}
        </div>

        {/* Gradient fade over teaser content */}
        <div style={{
          position: 'absolute',
          top: '200px',
          left: 0,
          right: 0,
          height: '300px',
          background: 'linear-gradient(transparent, var(--bg-primary))',
          pointerEvents: 'none',
          zIndex: 10,
        }} />

        {/* Signup CTA */}
        <div style={{
          position: 'relative',
          zIndex: 20,
          marginTop: '-100px',
          paddingBottom: '60px',
        }}>
          <div style={{
            maxWidth: '500px',
            margin: '0 auto',
            padding: '48px 32px',
            textAlign: 'center',
            background: 'var(--bg-primary)',
            border: '1px solid var(--border-primary)',
            borderRadius: '8px',
          }}>
            <div style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '11px',
              fontWeight: 600,
              letterSpacing: '0.1em',
              textTransform: 'uppercase',
              color: 'var(--accent-green)',
              marginBottom: '16px',
            }}>
              {readCount} of {ANON_FREE_READS} free reads used
            </div>
            <h2 style={{
              fontFamily: 'var(--font-display)',
              fontSize: '28px',
              fontWeight: 700,
              color: 'var(--text-primary)',
              lineHeight: 1.2,
              marginBottom: '12px',
            }}>
              Create a free account to keep reading
            </h2>
            <p style={{
              fontFamily: 'var(--font-body)',
              fontSize: '15px',
              color: 'var(--text-secondary)',
              lineHeight: 1.6,
              marginBottom: '24px',
            }}>
              Sign up for {SIGNUP_FREE_READS - ANON_FREE_READS} more free analyses — propagation maps, AI debate replays, framing splits, buried evidence.
            </p>
            <a
              href="/signup"
              style={{
                display: 'inline-block',
                fontFamily: 'var(--font-mono)',
                fontSize: '14px',
                fontWeight: 600,
                color: 'var(--bg-primary)',
                background: 'var(--text-primary)',
                padding: '14px 40px',
                textDecoration: 'none',
                borderRadius: '4px',
              }}
            >
              sign up free
            </a>
            <div style={{ marginTop: '16px' }}>
              <a href="/login" style={{
                fontFamily: 'var(--font-body)',
                fontSize: '13px',
                color: 'var(--text-tertiary)',
                textDecoration: 'none',
              }}>
                Already have an account? <span style={{ color: 'var(--accent-green)', textDecoration: 'underline' }}>Sign in</span>
              </a>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── TIER 3: PAYWALL (logged in, reads 6+) ──
  return (
    <div style={{ position: 'relative' }}>
      <div style={{ maxHeight: '600px', overflow: 'hidden' }}>
        {children}
      </div>
      <Paywall readCount={readCount} isLoggedIn={isLoggedIn} />
    </div>
  );
}
