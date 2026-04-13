"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { recordLocalRead, isPaywalled, remainingReads, FREE_READS } from "@/lib/paywall";
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

  // If not loaded yet, show nothing (prevents flash)
  if (!loaded) return <>{children}</>;

  // Admin and subscribers always see full content
  if (isAdmin || isSubscribed) return <>{children}</>;

  // NOT LOGGED IN — show teaser content + signup overlay
  if (!isLoggedIn) {
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

        {/* Signup CTA — always visible below the fade */}
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
              5 free articles on us
            </div>
            <h2 style={{
              fontFamily: 'var(--font-display)',
              fontSize: '28px',
              fontWeight: 700,
              color: 'var(--text-primary)',
              lineHeight: 1.2,
              marginBottom: '12px',
            }}>
              Sign up to read the full analysis
            </h2>
            <p style={{
              fontFamily: 'var(--font-body)',
              fontSize: '15px',
              color: 'var(--text-secondary)',
              lineHeight: 1.6,
              marginBottom: '24px',
            }}>
              Propagation maps, AI debate replays, framing splits, buried evidence — the full experience. No feature restrictions.
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
            <p style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '11px',
              color: 'var(--text-tertiary)',
              marginTop: '20px',
            }}>
              Then $4.99/mo for unlimited access
            </p>
          </div>
        </div>
      </div>
    );
  }

  // LOGGED IN but not subscribed — metered paywall after 10 reads
  const paywalled = isPaywalled(readCount);
  const remaining = remainingReads(readCount);

  if (paywalled) {
    return (
      <div style={{ position: 'relative', maxHeight: '600px', overflow: 'hidden' }}>
        {children}
        <Paywall readCount={readCount} isLoggedIn={isLoggedIn} />
      </div>
    );
  }

  return (
    <>
      <ReadCounter remaining={remaining} total={FREE_READS} />
      {children}
    </>
  );
}
