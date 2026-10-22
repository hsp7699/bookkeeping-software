"use client";

import { X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { Card } from "@/components/ui/table";
import { removeTrackingAction, saveTrackingAction } from "./tracking-actions";

type Kind = "class" | "location" | "tag";
const COPY: Record<Kind, { title: string; blurb: string; placeholder: string }> = {
  class: { title: "Classes", blurb: "Tag lines on a transaction with a department, service line or project type, then run the P&L by class.", placeholder: "Design" },
  location: { title: "Locations", blurb: "Put a whole transaction under a store, office or region, then run the P&L by location.", placeholder: "Portland" },
  tag: { title: "Tags", blurb: "Free-form labels for finding transactions later. They don't change any report totals.", placeholder: "Q4 campaign" },
};

export function TrackingSection({ companyId, kind, items }: { companyId: string; kind: Kind; items: { id: string; name: string }[] }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const c = COPY[kind];
  return (
    <Card className="p-6">
      <h2 className="text-lg font-semibold">{c.title}</h2>
      <p className="mt-1 mb-4 text-text-muted">{c.blurb}</p>
      {items.length > 0 && (
        <ul className="mb-4 flex flex-wrap gap-2" aria-label={c.title}>
          {items.map((i) => (
            <li key={i.id} className="flex items-center gap-1 rounded-pill bg-surface py-1 pr-1 pl-3 text-sm">
              {i.name}
              <button
                type="button"
                aria-label={`Remove ${i.name}`}
                className="rounded-pill p-0.5 text-text-muted hover:bg-row-hover hover:text-danger"
                onClick={() =>
                  start(async () => {
                    await removeTrackingAction(companyId, kind, i.id);
                    router.refresh();
                  })
                }
              >
                <X className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          start(async () => {
            const res = await saveTrackingAction(companyId, kind, { name });
            if (!res.ok) return setError(res.error);
            setError(null);
            setName("");
            router.refresh();
          });
        }}
      >
        <Input aria-label={`New ${kind} name`} value={name} onChange={(e) => setName(e.target.value)} placeholder={c.placeholder} className="max-w-xs" />
        <Button type="submit" loading={pending}>
          Add {kind}
        </Button>
      </form>
      {error && (
        <p role="alert" className="mt-2 text-danger">
          {error}
        </p>
      )}
    </Card>
  );
}
