"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { acceptInviteAction } from "../../actions";
import { FormError } from "../../auth-card";

export function AcceptInvite({ token }: { token: string }) {
  const [state, action, pending] = useActionState(acceptInviteAction, undefined);
  return (
    <form action={action} className="flex flex-col gap-3">
      <FormError message={state?.error} />
      <input type="hidden" name="token" value={token} />
      <Button type="submit" variant="primary" size="lg" loading={pending}>
        Accept invitation
      </Button>
    </form>
  );
}
