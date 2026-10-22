"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { signUpAction } from "../actions";
import { AuthCard, FormError } from "../auth-card";

export default function SignUpPage() {
  const [state, action, pending] = useActionState(signUpAction, undefined);
  const fe = state?.fieldErrors ?? {};
  return (
    <AuthCard
      title="Create your account"
      footer={
        <>
          Already have an account?{" "}
          <Link className="text-accent hover:underline" href="/login">
            Sign in
          </Link>
        </>
      }
    >
      <form action={action} className="flex flex-col gap-4">
        <FormError message={state?.error} />
        <Field label="Your name" error={fe.name}>
          {(p) => <Input {...p} name="name" autoComplete="name" required autoFocus />}
        </Field>
        <Field label="Email" error={fe.email}>
          {(p) => <Input {...p} name="email" type="email" autoComplete="email" required />}
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
