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

  // Don't render anything until we've checked auth
  if (!loaded) return <>{children}</>;

  // Admin and subscribers always see full content
  if (isAdmin || isSubscribed) return <>{children}</>;

  // Check paywall
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
