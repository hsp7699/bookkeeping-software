import { BookOpen, LogOut } from "lucide-react";
import Link from "next/link";
import { signOutAction } from "@/app/(auth)/actions";
import { query } from "@/db";
import { requireCompany } from "@/lib/authz";
import { CompanySwitcher } from "./company-switcher";
import { Nav } from "./nav";
import { NewMenu } from "./new-menu";
import { SearchBox } from "./search-box";

export default async function CompanyLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ companyId: string }>;
}) {
  const { companyId } = await params;
  const ctx = await requireCompany(companyId);
  const companies = await query<{ id: string; name: string }>(
    "select c.id, c.name from memberships m join companies c on c.id = m.company_id where m.user_id = $1 and m.status = 'active' order by lower(c.name)",
    [ctx.userId],
  );
  const isAdmin = ctx.role === "owner" || ctx.role === "admin";
  const viewOnly = ctx.role === "reports_only";
  return (
    <div className="flex min-h-dvh">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:bg-bg focus:p-2">
        Skip to content
      </a>
      <aside className="sticky top-0 hidden h-dvh w-[var(--nav-width)] shrink-0 overflow-y-auto bg-nav-bg lg:block">
        <Link href={`/c/${companyId}`} className="flex h-[var(--header-height)] items-center gap-2 px-6 text-md font-bold text-nav-text-active">
          <BookOpen className="size-5" aria-hidden /> Books
        </Link>
        <Nav companyId={companyId} isAdmin={isAdmin} />
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-[var(--header-height)] items-center gap-4 border-b border-border bg-bg px-6">
          {!viewOnly && <NewMenu companyId={companyId} />}
          <CompanySwitcher current={companyId} companies={companies} />
          <SearchBox companyId={companyId} />
          <form action={signOutAction} className="ml-auto">
            <button type="submit" className="flex items-center gap-2 rounded-md px-2 py-1 text-text-muted hover:bg-row-hover">
              <LogOut className="size-4" aria-hidden /> Sign out
            </button>
          </form>
        </header>
        <main id="main" className="mx-auto w-full max-w-[var(--content-max)] flex-1 p-6">
          {viewOnly && (
            <p role="note" className="mb-4 rounded-md bg-info-soft px-4 py-2 text-on-info-soft">
              You have view-only access to {ctx.companyName}. You can run reports and look things up, but not make changes.
            </p>
          )}
          {children}
        </main>
      </div>
    </div>
  );
}
