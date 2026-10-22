import { BookOpen } from "lucide-react";

export function AuthCard({ title, children, footer }: { title: string; children: React.ReactNode; footer?: React.ReactNode }) {
  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">
        <div className="mb-6 flex items-center justify-center gap-2 text-lg font-bold">
          <BookOpen className="size-6 text-accent" aria-hidden /> Books
        </div>
        <div className="rounded-lg border border-border bg-bg p-8 shadow-card">
          <h1 className="mb-6 text-xl font-bold">{title}</h1>
          {children}
        </div>
        {footer && <p className="mt-4 text-center text-text-muted">{footer}</p>}
      </div>
    </main>
  );
}

export function FormError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-on-danger-soft">
      {message}
    </p>
  );
}
