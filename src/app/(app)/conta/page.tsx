import { requireUser } from "@/lib/auth/guard";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { formatDateTime } from "@/lib/format";
import { ROLE_DESCRIPTIONS, ROLE_LABELS } from "@/lib/labels";
import { ChangePasswordForm } from "./change-password-form";

export const metadata = { title: "Minha conta — portfolio" };
export const dynamic = "force-dynamic";

export default async function AccountPage({
  searchParams,
}: {
  searchParams: Promise<{ trocar?: string }>;
}) {
  const user = await requireUser();
  const { trocar } = await searchParams;

  return (
    <div className="max-w-2xl space-y-4">
      <header>
        <h1 className="text-lg font-semibold">Minha conta</h1>
      </header>

      <Card>
        <CardHeader title="Dados de acesso" />
        <CardBody className="grid gap-3 sm:grid-cols-2">
          <Info label="Nome" value={user.name} />
          <Info label="Login" value={user.login} />
          <Info label="E-mail" value={user.email} />
          <div>
            <p className="label">Perfil</p>
            <Badge tone="blue">{ROLE_LABELS[user.role]}</Badge>
            <p className="mt-1 text-xs text-fg-muted">{ROLE_DESCRIPTIONS[user.role]}</p>
          </div>
          <Info label="Último acesso" value={formatDateTime(user.lastLoginAt)} />
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Trocar senha"
          description={
            user.mustChangePassword || trocar === "1"
              ? "Sua senha foi definida pelo administrador. Escolha uma senha sua para continuar."
              : undefined
          }
        />
        <CardBody>
          <ChangePasswordForm />
        </CardBody>
      </Card>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="label">{label}</p>
      <p className="text-sm">{value}</p>
    </div>
  );
}
