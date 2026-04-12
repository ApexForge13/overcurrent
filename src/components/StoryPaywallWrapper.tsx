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

  // NOT LOGGED IN — require signup to read ANY story
  if (!isLoggedIn) {
    return (
      <div style={{ position: 'relative', maxHeight: '400px', overflow: 'hidden' }}>
        {children}
        <div style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          height: '300px',
          background: 'linear-gradient(transparent, var(--bg-primary) 70%)',
          pointerEvents: 'none',
          zIndex: 10,
        }} />
        <div style={{
          position: 'relative',
          zIndex: 20,
          maxWidth: '480px',
          margin: '0 auto',
          padding: '40px 32px',
          textAlign: 'center',
        }}>
          <h2 style={{
            fontFamily: 'var(--font-display)',
            fontSize: '24px',
            fontWeight: 700,
            color: 'var(--text-primary)',
            marginBottom: '12px',
          }}>
            Sign up to read the full analysis
          </h2>
          <p style={{
            fontFamily: 'var(--font-body)',
            fontSize: '14px',
            color: 'var(--text-secondary)',
            lineHeight: 1.6,
            marginBottom: '20px',
          }}>
            10 free analyses. Full experience — framing splits, AI debate replay, propagation maps, everything. No feature restrictions.
          </p>
          <a
            href="/signup"
            style={{
              display: 'inline-block',
              fontFamily: 'var(--font-mono)',
              fontSize: '13px',
              color: 'var(--bg-primary)',
              background: 'var(--text-primary)',
              padding: '12px 32px',
              textDecoration: 'none',
            }}
          >
            sign up free
          </a>
          <p className="mt-4" style={{
            fontFamily: 'var(--font-body)',
            fontSize: '12px',
            color: 'var(--text-tertiary)',
          }}>
            Already have an account? <a href="/login" style={{ color: 'var(--accent-blue)', textDecoration: 'underline' }}>Sign in</a>
          </p>
          <p className="mt-6" style={{
            fontFamily: 'var(--font-mono)',
            fontSize: '11px',
            color: 'var(--text-tertiary)',
          }}>
            Then $4.99/mo for unlimited access
          </p>
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
