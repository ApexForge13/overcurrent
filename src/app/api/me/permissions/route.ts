import { getUserPermissions } from '@/lib/permissions'

export async function GET() {
  const perms = await getUserPermissions()
  return Response.json({
    isAuthenticated: perms.isAuthenticated,
    isAdmin: perms.isAdmin,
    tier: perms.tier,
    status: perms.status,
    isPaid: perms.isPaid,
    canAccessSearch: perms.canAccessSearch,
  })
}
