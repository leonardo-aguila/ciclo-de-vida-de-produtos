import { Nav } from "@/components/layout/nav";

/**
 * Application shell. Authentication is wired in phase 2; until then the shell
 * renders with a placeholder identity so the navigation can be reviewed.
 */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen">
      <aside className="no-print w-56 shrink-0">
        <Nav role="admin" userName="—" />
      </aside>
      <main className="min-w-0 flex-1 px-6 py-6">{children}</main>
    </div>
  );
}
