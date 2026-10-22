import Link from "next/link";
import { Card } from "@/components/ui/table";
import { cn } from "@/lib/cn";
import { formatCents } from "@/lib/money";

/** Page chrome shared by every report: back link, title, toolbar slot, and the printable card. */
export function ReportFrame({
  companyId,
  title,
  companyName,
  subtitle,
  toolbar,
  wide,
  children,
}: {
  companyId: string;
  title: string;
  companyName: string;
  subtitle: string;
  toolbar: React.ReactNode;
  wide?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-6">
      <div className="print:hidden">
        <Link href={`/c/${companyId}/reports`} className="text-sm text-accent hover:underline">
          ← Reports
        </Link>
        <h1 className="mt-1 text-xl font-bold">{title}</h1>
      </div>
      {toolbar}
      <Card className={cn("mx-auto w-full overflow-x-auto px-8 py-8 print:border-0 print:shadow-none", wide ? "max-w-none" : "max-w-3xl")}>
        <header className="mb-6 text-center">
          <p className="text-md font-semibold">{companyName}</p>
          <p className="text-lg font-bold">{title}</p>
          <p className="text-text-muted">{subtitle}</p>
        </header>
        {children}
      </Card>
    </div>
  );
}

/** An amount cell; with `href`, a drill-down link to the transactions behind it. */
export function Amount({ cents, href, strong, className }: { cents: number; href?: string; strong?: boolean; className?: string }) {
  const text = <span className={cn("num", cents < 0 && "text-negative-amount", strong && "font-semibold")}>{formatCents(cents)}</span>;
  return (
    <td className={cn("py-1 pl-4 text-right", className)}>
      {href && cents !== 0 ? (
        <Link href={href} className="hover:underline">
          {text}
        </Link>
      ) : (
        text
      )}
    </td>
  );
}
