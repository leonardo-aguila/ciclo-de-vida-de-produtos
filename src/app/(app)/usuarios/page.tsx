import { asc } from "drizzle-orm";
import { db } from "@db";
import { users } from "@db/schema";
import { requireAdmin } from "@/lib/auth/guard";
import { UsersClient } from "./users-client";

export const metadata = { title: "Usuários — portfolio" };
export const dynamic = "force-dynamic";

export default async function UsersPage() {
  const actor = await requireAdmin();

  const rows = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      login: users.login,
      role: users.role,
      active: users.active,
      lastLoginAt: users.lastLoginAt,
      lockedUntil: users.lockedUntil,
      mustChangePassword: users.mustChangePassword,
    })
    .from(users)
    .orderBy(asc(users.name));

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-lg font-semibold">Usuários</h1>
        <p className="text-sm text-fg-muted">
          Quem acessa o sistema, com que perfil, e quando acessou pela última vez.
        </p>
      </header>
      <UsersClient users={rows} currentUserId={actor.id} />
    </div>
  );
}
