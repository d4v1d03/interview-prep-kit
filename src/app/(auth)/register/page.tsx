import { register } from "@/server/auth/actions";
import { AuthForm } from "../auth-form";

export default async function RegisterPage({ searchParams }: PageProps<"/register">) {
  const { next } = await searchParams;
  return <AuthForm mode="register" action={register} next={typeof next === "string" ? next : undefined} />;
}
