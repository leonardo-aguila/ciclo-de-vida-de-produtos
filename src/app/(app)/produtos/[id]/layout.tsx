import { Pencil } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { requireUser } from "@/lib/auth/guard";
import { canEditProduct } from "@/lib/auth/policy";
import { formatDate } from "@/lib/format";
import { PHASE_LABELS, PRODUCT_STATUS_LABELS } from "@/lib/labels";
import { getProduct } from "@/lib/queries/products";
import { ProductTabs } from "./product-tabs";

export default async function ProductLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await requireUser();
  const product = await getProduct(id);
  if (!product) notFound();

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-lg font-semibold">{product.name}</h1>
            <span className="font-mono text-xs text-fg-muted">{product.code}</span>
            <Badge tone="blue">{PHASE_LABELS[product.phase]}</Badge>
            {product.status !== "active" ? (
              <Badge tone={product.status === "paused" ? "amber" : "neutral"}>
                {PRODUCT_STATUS_LABELS[product.status]}
              </Badge>
            ) : null}
          </div>
          <p className="mt-1 text-xs text-fg-muted">
            Início em {formatDate(product.startDate)}
            {product.actualLaunchDate
              ? ` · lançado em ${formatDate(product.actualLaunchDate)}`
              : product.plannedLaunchDate
                ? ` · lançamento previsto para ${formatDate(product.plannedLaunchDate)}`
                : ""}
          </p>
        </div>

        {canEditProduct(user, product) ? (
          <Button asChild variant="secondary" size="sm">
            <Link href={`/produtos/${product.id}/editar`}>
              <Pencil className="h-4 w-4" />
              Editar
            </Link>
          </Button>
        ) : null}
      </header>

      <ProductTabs productId={product.id} />

      {children}
    </div>
  );
}
