import { BookOpen, LogOut } from "lucide-react";
import Link from "next/link";
import { signOutAction } from "@/app/(auth)/actions";
import { requireCompany } from "@/lib/authz";
import { Nav } from "./nav";
import { NewMenu } from "./new-menu";

export default async function CompanyLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ companyId: string }>;
}) {
  const { companyId } = await params;
  const ctx = await requireCompany(companyId);
  return (
    <div className="flex min-h-dvh">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:bg-bg focus:p-2">
        Skip to content
      </a>
      <aside className="sticky top-0 hidden h-dvh w-[var(--nav-width)] shrink-0 overflow-y-auto bg-nav-bg lg:block">
        <Link href={`/c/${companyId}`} className="flex h-[var(--header-height)] items-center gap-2 px-6 text-md font-bold text-nav-text-active">
          <BookOpen className="size-5" aria-hidden /> Books
        </Link>
        <Nav companyId={companyId} />
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-[var(--header-height)] items-center gap-4 border-b border-border bg-bg px-6">
          <NewMenu companyId={companyId} />
          <p className="truncate font-semibold">{ctx.companyName}</p>
          <form action={signOutAction} className="ml-auto">
            <button type="submit" className="flex items-center gap-2 rounded-md px-2 py-1 text-text-muted hover:bg-row-hover">
              <LogOut className="size-4" aria-hidden /> Sign out
            </button>
          </form>
        </header>
        <main id="main" className="mx-auto w-full max-w-[var(--content-max)] flex-1 p-6">
          {children}
        </main>
      </div>
    </div>
  );
}
