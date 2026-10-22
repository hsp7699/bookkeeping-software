"use client";

import { forwardRef, useId, useState } from "react";
import { cn } from "@/lib/cn";
import { formatCentsPlain, parseMoney, type Cents } from "@/lib/money";

export const inputClass = cn(
  "h-9 w-full rounded-sm border border-border-input bg-bg px-2.5 text-base text-text",
  "placeholder:text-text-subtle hover:border-text-muted",
  "focus:outline-none focus:border-focus-ring focus:ring-2 focus:ring-focus-ring/25",
  "disabled:bg-surface disabled:text-text-muted",
  "aria-[invalid=true]:border-danger aria-[invalid=true]:ring-danger/20",
);

interface FieldProps {
  label: string;
  error?: string;
  hint?: string;
  required?: boolean;
  className?: string;
  children: (props: { id: string; "aria-invalid"?: boolean; "aria-describedby"?: string }) => React.ReactNode;
}

/** Label + control + hint or error, wired for screen readers. */
export function Field({ label, error, hint, required, className, children }: FieldProps) {
  const id = useId();
  const msgId = `${id}-msg`;
  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <label htmlFor={id} className="text-sm font-medium text-text">
        {label}
        {required && <span className="font-normal text-text-muted"> (required)</span>}
      </label>
      {children({ id, "aria-invalid": error ? true : undefined, "aria-describedby": error || hint ? msgId : undefined })}
      {(error || hint) && (
        <p id={msgId} className={cn("text-sm", error ? "text-danger" : "text-text-muted")}>
          {error ?? hint}
        </p>
      )}
    </div>
  );
}

export const Input = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(function Input(
  { className, ...rest },
  ref,
) {
  return <input ref={ref} className={cn(inputClass, className)} {...rest} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function Textarea({ className, ...rest }, ref) {
    return <textarea ref={ref} className={cn(inputClass, "h-auto min-h-20 py-2", className)} {...rest} />;
  },
);

export const NativeSelect = forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(
  function NativeSelect({ className, ...rest }, ref) {
    return <select ref={ref} className={cn(inputClass, "pr-8", className)} {...rest} />;
  },
);

interface MoneyInputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange"> {
  value: Cents | null;
  onValueChange: (cents: Cents | null) => void;
  allowNegative?: boolean;
}

/** Types like a text field, stores integer cents, formats on blur. "=12*3" works. */
export function MoneyInput({ value, onValueChange, allowNegative = false, className, onBlur, ...rest }: MoneyInputProps) {
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? (value == null ? "" : formatCentsPlain(value));
  return (
    <input
      inputMode="decimal"
      autoComplete="off"
      className={cn(inputClass, "num", className)}
      value={shown}
      onChange={(e) => setDraft(e.target.value)}
      onFocus={(e) => e.target.select()}
      onBlur={(e) => {
        if (draft != null) {
          const parsed = parseMoney(draft);
          if (parsed == null || (!allowNegative && parsed < 0)) onValueChange(draft.trim() === "" ? null : value);
          else onValueChange(parsed);
          setDraft(null);
        }
        onBlur?.(e);
      }}
      {...rest}
    />
  );
}
