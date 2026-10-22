"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Button } from "@/components/ui/button";
import { undoAction } from "../actions";

export function UndoButton({ companyId, reconId }: { companyId: string; reconId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <div>
      <Button variant="ghost" className="text-danger" onClick={() => setOpen(true)}>
        Undo this reconciliation
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title="Undo this reconciliation?"
        body="Its transactions become editable again and go back to cleared. Only the most recent reconciliation of an account can be undone."
        confirmLabel="Undo"
        destructive
        pending={pending}
        onConfirm={() =>
          start(async () => {
            const res = await undoAction(companyId, reconId);
            if (!res.ok) return setError(res.error);
            setOpen(false);
            router.push(`/c/${companyId}/reconcile`);
            router.refresh();
          })
        }
      >
        {error && (
          <p role="alert" className="mt-3 text-danger">
            {error}
          </p>
        )}
      </ConfirmDialog>
    </div>
  );
}
