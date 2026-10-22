"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { signInAction } from "../actions";
import { AuthCard, FormError } from "../auth-card";

function LoginForm() {
  const [state, action, pending] = useActionState(signInAction, undefined);
  const next = useSearchParams().get("callbackUrl") ?? "/";
  return (
    <form action={action} className="flex flex-col gap-4">
      <FormError message={state?.error} />
      <input type="hidden" name="next" value={next} />
      <Field label="Email">{(p) => <Input {...p} name="email" type="email" autoComplete="email" required autoFocus />}</Field>
      <Field label="Password">
        {(p) => <Input {...p} name="password" type="password" autoComplete="current-password" required />}
      </Field>
      <Button type="submit" variant="primary" size="lg" loading={pending}>
        Sign in
      </Button>
    </form>
  );
}

export default function LoginPage() {
  return (
    <AuthCard
      title="Sign in"
      footer={
        <>
          New here?{" "}
          <Link className="text-accent hover:underline" href="/signup">
            Create an account
          </Link>
        </>
      }
    >
      <Suspense>
        <LoginForm />
      </Suspense>
    </AuthCard>
  );
}
