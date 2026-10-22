"use client";

import { Field, NativeSelect } from "@/components/ui/field";
import { cn } from "@/lib/cn";

export interface Tracking {
  classes: { id: string; name: string }[];
  locations: { id: string; name: string }[];
  tags: { id: string; name: string }[];
}

/** Location and tags for a transaction header. Shows only what the company uses. */
export function TrackingHeader({
  tracking,
  locationId,
  onLocation,
  tagIds,
  onTags,
}: {
  tracking: Tracking;
  locationId: string | null;
  onLocation: (v: string | null) => void;
  tagIds: string[];
  onTags: (v: string[]) => void;
}) {
  if (tracking.locations.length === 0 && tracking.tags.length === 0) return null;
  return (
    <div className="mt-4 flex flex-wrap items-end gap-6">
      {tracking.locations.length > 0 && (
        <Field label="Location" className="w-56">
          {(p) => (
            <NativeSelect {...p} value={locationId ?? ""} onChange={(e) => onLocation(e.target.value || null)}>
              <option value="">None</option>
              {tracking.locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </NativeSelect>
          )}
        </Field>
      )}
      {tracking.tags.length > 0 && (
        <fieldset>
          <legend className="mb-1 text-sm font-medium">Tags</legend>
          <div className="flex flex-wrap gap-1.5">
            {tracking.tags.map((t) => {
              const on = tagIds.includes(t.id);
              return (
                <button
                  key={t.id}
                  type="button"
                  aria-pressed={on}
                  onClick={() => onTags(on ? tagIds.filter((x) => x !== t.id) : [...tagIds, t.id])}
                  className={cn("rounded-pill border px-3 py-1 text-sm", on ? "border-accent bg-accent-soft text-on-accent-soft" : "border-border-input text-text-muted hover:bg-row-hover")}
                >
                  {t.name}
                </button>
              );
            })}
          </div>
        </fieldset>
      )}
    </div>
  );
}

/** A compact class picker for a line. */
export function ClassSelect({ classes, value, onChange, label }: { classes: { id: string; name: string }[]; value: string | null; onChange: (v: string | null) => void; label: string }) {
  return (
    <NativeSelect aria-label={label} value={value ?? ""} onChange={(e) => onChange(e.target.value || null)}>
      <option value="">—</option>
      {classes.map((c) => (
        <option key={c.id} value={c.id}>
          {c.name}
        </option>
      ))}
    </NativeSelect>
  );
}
