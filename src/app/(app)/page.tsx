import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/states";

export default function DashboardPage() {
  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-lg font-semibold">Painel executivo</h1>
        <p className="text-sm text-fg-muted">Visão consolidada do portfólio.</p>
      </header>
      <Card>
        <CardHeader title="Portfólio" />
        <CardBody>
          <EmptyState
            title="O painel entra na fase 9"
            description="A fundação está de pé: banco, schema, navegação e formatação pt-BR."
          />
        </CardBody>
      </Card>
    </div>
  );
}
