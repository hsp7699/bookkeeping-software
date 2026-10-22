import type { LucideIcon } from "lucide-react";

export function EmptyState({
  icon: Icon,
  title,
  body,
  action,
}: {
  icon: LucideIcon;
  title: string;
  body: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
      <span className="flex size-12 items-center justify-center rounded-pill bg-accent-soft text-on-accent-soft">
        <Icon className="size-6" aria-hidden />
      </span>
      <h2 className="text-md font-semibold">{title}</h2>
      <p className="max-w-sm text-text-muted">{body}</p>
      {action && <div className="mt-2 flex gap-2">{action}</div>}
    </div>
  );
}
