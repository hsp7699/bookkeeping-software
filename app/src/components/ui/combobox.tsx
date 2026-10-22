"use client";

import * as Popover from "@radix-ui/react-popover";
import { Check, ChevronDown, Plus } from "lucide-react";
import { useId, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { inputClass } from "./field";

export interface ComboOption {
  value: string;
  label: string;
  hint?: string;
}

interface ComboboxProps {
  id?: string;
  options: ComboOption[];
  value: string | null;
  onChange: (value: string | null) => void;
  placeholder?: string;
  /** shows "+ Add new" as the last option; receives what was typed */
  onAddNew?: (typed: string) => void;
  addNewLabel?: string;
  className?: string;
  "aria-invalid"?: boolean;
  "aria-describedby"?: string;
  "aria-label"?: string;
  disabled?: boolean;
}

/** Type-to-filter picker. Arrow keys move, Enter selects, Esc closes. */
export function Combobox({
  id,
  options,
  value,
  onChange,
  placeholder = "Select",
  onAddNew,
  addNewLabel = "Add new",
  className,
  disabled,
  ...aria
}: ComboboxProps) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [active, setActive] = useState(0);
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const selected = options.find((o) => o.value === value) ?? null;

  const filtered = useMemo(() => {
    const q = typed.trim().toLowerCase();
    return q ? options.filter((o) => o.label.toLowerCase().includes(q) || o.hint?.toLowerCase().includes(q)) : options;
  }, [options, typed]);
  const total = filtered.length + (onAddNew ? 1 : 0);

  function choose(i: number) {
    if (i < filtered.length) {
      onChange(filtered[i].value);
    } else if (onAddNew) {
      onAddNew(typed.trim());
    }
    setOpen(false);
    setTyped("");
  }

  return (
    <Popover.Root open={open} onOpenChange={(o) => { setOpen(o); if (!o) setTyped(""); }}>
      <Popover.Anchor asChild>
        <div className={cn("relative", className)}>
          <input
            ref={inputRef}
            id={id}
            role="combobox"
            aria-expanded={open}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={open && total > 0 ? `${listId}-${active}` : undefined}
            disabled={disabled}
            autoComplete="off"
            className={cn(inputClass, "pr-8")}
            placeholder={placeholder}
            value={open ? typed : selected?.label ?? ""}
            onChange={(e) => {
              setTyped(e.target.value);
              setActive(0);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onClick={() => setOpen(true)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setOpen(true);
                setActive((a) => Math.min(a + 1, total - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setActive((a) => Math.max(a - 1, 0));
              } else if (e.key === "Enter" && open) {
                e.preventDefault();
                if (total > 0) choose(active);
              } else if (e.key === "Escape") {
                setOpen(false);
              } else if (e.key === "Tab") {
                setOpen(false);
              }
            }}
            {...aria}
          />
          <ChevronDown className="pointer-events-none absolute top-1/2 right-2.5 size-4 -translate-y-1/2 text-text-muted" aria-hidden />
        </div>
      </Popover.Anchor>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={4}
          onOpenAutoFocus={(e) => e.preventDefault()}
          onInteractOutside={(e) => {
            if (e.target === inputRef.current) e.preventDefault();
          }}
          className="z-50 max-h-72 w-[var(--radix-popover-trigger-width)] min-w-56 overflow-y-auto rounded-md border border-border bg-bg py-1 shadow-pop"
        >
          <ul id={listId} role="listbox">
            {filtered.map((o, i) => (
              <li
                key={o.value}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={o.value === value}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => choose(i)}
                onMouseEnter={() => setActive(i)}
                className={cn("flex cursor-pointer items-center gap-2 px-3 py-1.5", i === active && "bg-row-hover")}
              >
                <Check className={cn("size-4 shrink-0 text-accent", o.value !== value && "invisible")} aria-hidden />
                <span className="flex min-w-0 flex-col">
                  <span className="truncate">{o.label}</span>
                  {o.hint && <span className="truncate text-sm text-text-muted">{o.hint}</span>}
                </span>
              </li>
            ))}
            {filtered.length === 0 && !onAddNew && <li className="px-3 py-2 text-text-muted">No matches</li>}
            {onAddNew && (
              <li
                id={`${listId}-${filtered.length}`}
                role="option"
                aria-selected={false}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => choose(filtered.length)}
                onMouseEnter={() => setActive(filtered.length)}
                className={cn(
                  "flex cursor-pointer items-center gap-2 border-t border-border px-3 py-2 font-semibold text-accent",
                  active === filtered.length && "bg-row-hover",
                )}
              >
                <Plus className="size-4" aria-hidden />
                {typed.trim() ? `${addNewLabel}: “${typed.trim()}”` : addNewLabel}
              </li>
            )}
          </ul>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
