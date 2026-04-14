import { createServerSupabaseClient } from '@/lib/supabase/server'

const ADMIN_EMAILS = (process.env.ADMIN_EMAILS ?? 'connermhecht13@gmail.com')
  .split(',')
  .map((e) => e.trim().toLowerCase())

/**
 * Verify the current user is an authenticated admin.
 * Returns the user on success, or a Response (401/403) on failure.
 */
export async function requireAdmin(): Promise<
  | { user: { id: string; email: string }; error?: never }
  | { user?: never; error: Response }
> {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return { error: Response.json({ error: 'Unauthorized' }, { status: 401 }) }
  }

  if (!user.email || !ADMIN_EMAILS.includes(user.email.toLowerCase())) {
    return { error: Response.json({ error: 'Forbidden' }, { status: 403 }) }
  }

  return { user: { id: user.id, email: user.email } }
}
