"use client";

import { useActionState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import type { AuthFormState } from "@/server/auth/actions";

type Props = {
  mode: "login" | "register";
  action: (prev: AuthFormState, formData: FormData) => Promise<AuthFormState>;
  next?: string;
  notice?: string;
};

export function AuthForm({ mode, action, next, notice }: Props) {
  const [state, formAction, pending] = useActionState(action, undefined);
  const isLogin = mode === "login";
  const fieldError = (name: string) => state?.fieldErrors?.[name]?.[0];

  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center px-4 py-12">
      <h1 className="text-2xl font-semibold tracking-tight">{isLogin ? "Log in" : "Create an account"}</h1>
      <p className="mt-1 text-sm text-muted">
        {isLogin ? "Pick up your interview prep where you left off." : "Your kits are private to your account."}
      </p>

      {notice && (
        <p role="status" className="mt-4 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm">
          {notice}
        </p>
      )}

      <form action={formAction} className="mt-6 space-y-4" noValidate>
        {next && <input type="hidden" name="next" value={next} />}
        <Field
          label="Email"
          name="email"
          type="email"
          autoComplete="email"
          defaultValue={state?.email}
          error={fieldError("email")}
        />
        <Field
          label="Password"
          name="password"
          type="password"
          autoComplete={isLogin ? "current-password" : "new-password"}
          hint={isLogin ? undefined : "At least 8 characters."}
          error={fieldError("password")}
        />

        <div aria-live="polite" className="min-h-5 text-sm text-danger">
          {state?.error}
        </div>

        <Button type="submit" disabled={pending} className="w-full">
          {pending ? "Please wait…" : isLogin ? "Log in" : "Create account"}
        </Button>
      </form>

      <p className="mt-6 text-sm text-muted">
        {isLogin ? "New here? " : "Already have an account? "}
        <Link
          href={{ pathname: isLogin ? "/register" : "/login", query: next ? { next } : {} }}
          className="font-medium text-accent underline-offset-4 hover:underline"
        >
          {isLogin ? "Create an account" : "Log in"}
        </Link>
      </p>
    </main>
  );
}

function Field({
  label,
  name,
  hint,
  error,
  ...input
}: { label: string; name: string; hint?: string; error?: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  const describedBy = error ? `${name}-error` : hint ? `${name}-hint` : undefined;
  return (
    <div>
      <label htmlFor={name} className="block text-sm font-medium">
        {label}
      </label>
      <input
        id={name}
        name={name}
        required
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className="mt-1 block w-full rounded-md border border-border bg-surface px-3 py-2 text-sm aria-invalid:border-danger"
        {...input}
      />
      {error ? (
        <p id={`${name}-error`} className="mt-1 text-xs text-danger">
          {error}
        </p>
      ) : hint ? (
        <p id={`${name}-hint`} className="mt-1 text-xs text-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
