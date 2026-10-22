"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { signUpAction } from "../actions";
import { AuthCard, FormError } from "../auth-card";

function SignUpForm({ invite, email }: { invite: string; email: string }) {
  const [state, action, pending] = useActionState(signUpAction, undefined);
  const fe = state?.fieldErrors ?? {};
  return (
    <AuthCard
      title="Create your account"
      footer={
        <>
          Already have an account?{" "}
          <Link className="text-accent hover:underline" href={invite ? `/login?callbackUrl=${encodeURIComponent(`/invite/${invite}`)}` : "/login"}>
            Sign in
          </Link>
        </>
      }
    >
      <form action={action} className="flex flex-col gap-4">
        <FormError message={state?.error} />
        {invite && <input type="hidden" name="invite" value={invite} />}
        <Field label="Your name" error={fe.name}>
          {(p) => <Input {...p} name="name" autoComplete="name" required autoFocus />}
        </Field>
        <Field label="Email" error={fe.email}>
          {(p) => <Input {...p} name="email" type="email" autoComplete="email" required defaultValue={email} readOnly={!!invite} />}
        </Field>
        <Field label="Password" error={fe.password} hint="At least 10 characters.">
          {(p) => <Input {...p} name="password" type="password" autoComplete="new-password" required minLength={10} />}
        </Field>
        <Button type="submit" variant="primary" size="lg" loading={pending}>
          Create account
        </Button>
      </form>
    </AuthCard>
  );
}

export default function SignUpPage() {
  return (
    <Suspense>
      <SignUpWithParams />
    </Suspense>
  );
}

function SignUpWithParams() {
  const sp = useSearchParams();
  return <SignUpForm invite={sp.get("invite") ?? ""} email={sp.get("email") ?? ""} />;
}
