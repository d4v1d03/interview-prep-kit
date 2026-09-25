import Link from "next/link";
import { requireUser } from "@/server/auth/dal";
import { logout } from "@/server/auth/actions";
import { Button } from "@/components/ui/button";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const user = await requireUser();
  return (
    <>
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-surface focus:px-3 focus:py-2">
        Skip to content
      </a>
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-3">
          <Link href="/kits" className="font-semibold tracking-tight">
            Interview Prep Kit
          </Link>
          <div className="flex items-center gap-3 text-sm">
            <span className="hidden text-muted sm:inline">{user.email}</span>
            <form action={logout}>
              <Button type="submit" variant="ghost">
                Log out
              </Button>
            </form>
          </div>
        </div>
      </header>
      <main id="main" className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">
        {children}
      </main>
    </>
  );
}
