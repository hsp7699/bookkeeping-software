import { cn } from "@/lib/cn";

export type PillTone = "overdue" | "due" | "open" | "partial" | "paid" | "deposited" | "voided" | "draft";

const tones: Record<PillTone, string> = {
  overdue: "bg-danger-soft text-on-danger-soft",
  due: "bg-warning-soft text-on-warning-soft",
  open: "bg-info-soft text-on-info-soft",
  partial: "bg-info-soft text-on-info-soft",
  paid: "bg-success-soft text-on-success-soft",
  deposited: "bg-success-soft text-on-success-soft",
  voided: "bg-surface text-text-muted",
  draft: "bg-surface text-text-muted",
};

export function StatusPill({ tone, children, className }: { tone: PillTone; children: React.ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-5 items-center rounded-pill px-2 text-xs font-medium whitespace-nowrap",
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
