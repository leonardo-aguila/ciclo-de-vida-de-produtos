import { requireAdmin } from "@/lib/auth/guard";
import { ConfigNav } from "./config-nav";

export const metadata = { title: "Configurações — portfolio" };

export default async function ConfigLayout({ children }: { children: React.ReactNode }) {
  await requireAdmin();

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-lg font-semibold">Configurações</h1>
        <p className="text-sm text-fg-muted">
          Parâmetros de cálculo, domínios administráveis e pacotes padrão de tarefas.
        </p>
      </header>
      <ConfigNav />
      {children}
    </div>
  );
}
