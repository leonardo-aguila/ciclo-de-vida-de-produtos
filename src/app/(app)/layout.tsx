import Link from "next/link";
import { Nav } from "@/components/layout/nav";
import { requireUser } from "@/lib/auth/guard";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();

  return (
    <div className="flex min-h-screen">
      <aside className="no-print w-56 shrink-0">
        <Nav role={user.role} userName={user.name} />
      </aside>
      <main className="min-w-0 flex-1 px-6 py-6">
        {user.mustChangePassword ? (
          <div
            role="alert"
            className="mb-4 rounded-lg border border-amber/40 bg-amber/10 px-3 py-2 text-xs text-amber"
          >
            Sua senha foi definida pelo administrador.{" "}
            <Link href="/conta" className="font-medium underline">
              Escolha uma senha sua
            </Link>
            .
          </div>
        ) : null}
        {children}
      </main>
    </div>
  );
}
