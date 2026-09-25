import { login } from "@/server/auth/actions";
import { AuthForm } from "../auth-form";

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const { next, reason } = await searchParams;
  return (
    <AuthForm
      mode="login"
      action={login}
      next={typeof next === "string" ? next : undefined}
      notice={reason === "expired" ? "Your session has expired. Please log in again." : undefined}
    />
  );
}
