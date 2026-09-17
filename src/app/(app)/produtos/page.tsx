import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/states";

export default function ProductsPage() {
  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-lg font-semibold">Produtos</h1>
      </header>
      <Card>
        <CardHeader title="Lista de produtos" />
        <CardBody>
          <EmptyState title="O CRUD de produtos entra na fase 3" />
        </CardBody>
      </Card>
    </div>
  );
}
