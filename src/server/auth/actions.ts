"use server";

import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db/client";
import { users } from "@/db/schema";
import { getDummyHash, hashPassword, verifyPassword } from "./password";
import { createSession, destroyCurrentSession } from "./session";

/** `email` is echoed back so the field survives React 19's automatic form reset after an action. */
export type AuthFormState =
  | { error?: string; fieldErrors?: Record<string, string[] | undefined>; email?: string }
  | undefined;

const submittedEmail = (formData: FormData) => String(formData.get("email") ?? "");

const credentialsSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email("Enter a valid email address.")),
  password: z.string().min(8, "Use at least 8 characters.").max(200),
});

/** Only same-site paths are honoured, so `?next=` cannot be used as an open redirect. */
function safeNext(value: FormDataEntryValue | null): string {
  const next = typeof value === "string" ? value : "";
  return next.startsWith("/") && !next.startsWith("//") ? next : "/kits";
}

export async function register(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const parsed = credentialsSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { fieldErrors: z.flattenError(parsed.error).fieldErrors, email: submittedEmail(formData) };

  const { email, password } = parsed.data;
  const [created] = await (await getDb())
    .insert(users)
    .values({ email, passwordHash: await hashPassword(password) })
    .onConflictDoNothing({ target: users.email })
    .returning({ id: users.id });
  if (!created) return { error: "An account with that email already exists. Try logging in.", email };

  await createSession(created.id);
  redirect(safeNext(formData.get("next")));
}

export async function login(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const parsed = credentialsSchema.safeParse(Object.fromEntries(formData));
  // Deliberately vague: login should not teach an attacker the password policy or which emails exist.
  if (!parsed.success) return { error: "Email or password is incorrect.", email: submittedEmail(formData) };

  const { email, password } = parsed.data;
  const [user] = await (await getDb()).select().from(users).where(eq(users.email, email)).limit(1);
  const ok = await verifyPassword(password, user?.passwordHash ?? (await getDummyHash()));
  if (!user || !ok) return { error: "Email or password is incorrect.", email };

  await createSession(user.id);
  redirect(safeNext(formData.get("next")));
}

export async function logout(): Promise<void> {
  await destroyCurrentSession();
  redirect("/login");
}
