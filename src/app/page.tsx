import { redirect } from "next/navigation";
import { getCurrentUser } from "@/server/auth/dal";

export default async function Home() {
  redirect((await getCurrentUser()) ? "/kits" : "/login");
}
