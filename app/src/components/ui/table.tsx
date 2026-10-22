import { cn } from "@/lib/cn";

// Plain, styled table parts. Lists that need sorting or selection wrap these with TanStack Table.

export function Table({ className, ...rest }: React.TableHTMLAttributes<HTMLTableElement>) {
  return <table className={cn("w-full border-collapse text-base", className)} {...rest} />;
}

export function Th({ className, numeric, ...rest }: React.ThHTMLAttributes<HTMLTableCellElement> & { numeric?: boolean }) {
  return (
    <th
      scope="col"
      className={cn(
        "h-9 border-b border-border bg-surface px-3 text-left text-xs font-medium tracking-wide text-text-muted uppercase",
        numeric && "text-right",
        className,
      )}
      {...rest}
    />
  );
}

export function Tr({ className, ...rest }: React.HTMLAttributes<HTMLTableRowElement>) {
  return <tr className={cn("border-b border-border hover:bg-row-hover", className)} {...rest} />;
}

export function Td({ className, numeric, ...rest }: React.TdHTMLAttributes<HTMLTableCellElement> & { numeric?: boolean }) {
  return <td className={cn("h-10 px-3", numeric && "num", className)} {...rest} />;
}

export function Card({ className, ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("rounded-lg border border-border bg-surface-raised shadow-card", className)} {...rest} />;
}
