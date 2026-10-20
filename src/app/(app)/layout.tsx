import { requireUserPage } from "@/lib/auth/guards";
import { AppShell } from "@/components/app/app-shell";

/**
 * Every authenticated route lives under this group. The session is verified
 * against the database on each request; unauthenticated visitors are sent to
 * the sign-in page. Role checks for specific areas happen in their own routes.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireUserPage();

  return (
    <AppShell
      user={{
        fullName: ctx.user.fullName,
        email: ctx.user.email,
        role: ctx.user.role,
        emailVerified: Boolean(ctx.user.emailVerifiedAt),
        forcePasswordChange: ctx.user.forcePasswordChange,
        status: ctx.user.status,
      }}
    >
      {children}
    </AppShell>
  );
}
