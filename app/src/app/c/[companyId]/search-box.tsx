"use client";

import { Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { inputClass } from "@/components/ui/field";
import { cn } from "@/lib/cn";

/** Header search. "/" focuses it from anywhere outside a text field. */
export function SearchBox({ companyId }: { companyId: string }) {
  const router = useRouter();
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.key === "/" && !t.closest("input,textarea,select,[contenteditable]")) {
        e.preventDefault();
        ref.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return (
    <form
      role="search"
      className="relative hidden w-72 md:block"
      onSubmit={(e) => {
        e.preventDefault();
        const q = ref.current?.value.trim();
        if (q) router.push(`/c/${companyId}/search?q=${encodeURIComponent(q)}`);
      }}
    >
      <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-text-muted" aria-hidden />
      <input ref={ref} type="search" aria-label="Search transactions and names" placeholder="Search  ( / )" className={cn(inputClass, "pl-8")} />
    </form>
  );
}
