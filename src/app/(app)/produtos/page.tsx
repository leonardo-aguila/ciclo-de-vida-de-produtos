import { Plus } from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/states";
import { requireUser } from "@/lib/auth/guard";
import { canCreateProduct } from "@/lib/auth/policy";
import { formatDate } from "@/lib/format";
import { PHASE_LABELS, PHASE_ORDER, PRODUCT_STATUS_LABELS } from "@/lib/labels";
import { listEnumValues } from "@/lib/queries/enums";
import { listProducts, listProductOwners } from "@/lib/queries/products";
import type { LifecyclePhase, Product } from "@db/schema";
import { ProductFilters } from "./product-filters";

export const metadata = { title: "Produtos — portfolio" };
export const dynamic = "force-dynamic";

const PHASE_TONE: Record<LifecyclePhase, "violet" | "blue" | "green" | "amber" | "neutral"> = {
  conception: "violet",
  development: "blue",
  launch: "blue",
  growth: "green",
  maturity: "green",
  decline: "amber",
  discontinued: "neutral",
};

export default async function ProductsPage({
  searchParams,
}: {
  searchParams: Promise<{
    fase?: string;
    situacao?: string;
    responsavel?: string;
    categoria?: string;
    busca?: string;
  }>;
}) {
  const user = await requireUser();
  const params = await searchParams;

  const phase = PHASE_ORDER.includes(params.fase as LifecyclePhase)
    ? (params.fase as LifecyclePhase)
    : undefined;
  const status = ["active", "paused", "discontinued"].includes(params.situacao ?? "")
    ? (params.situacao as Product["status"])
    : undefined;

  const [rows, owners, categories] = await Promise.all([
    listProducts({
      phase,
      status,
      ownerId: params.responsavel || undefined,
      categoryId: params.categoria || undefined,
      search: params.busca || undefined,
    }),
    listProductOwners(),
    listEnumValues("product_category"),
  ]);

  const hasFilters = Boolean(
    params.fase || params.situacao || params.responsavel || params.categoria || params.busca,
  );

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold">Produtos</h1>
          <p className="text-sm text-fg-muted">
            {rows.length === 1 ? "1 produto" : `${rows.length} produtos`} no portfólio.
          </p>
        </div>
        {canCreateProduct(user) ? (
          <Button asChild size="sm">
            <Link href="/produtos/novo">
              <Plus className="h-4 w-4" />
              Novo produto
            </Link>
          </Button>
        ) : null}
      </header>

      <ProductFilters
        owners={owners.map((owner) => ({ id: owner.id, label: owner.name }))}
        categories={categories.map((category) => ({ id: category.id, label: category.label }))}
      />

      {rows.length === 0 ? (
        <Card>
          <EmptyState
            title={hasFilters ? "Nenhum produto com esses filtros" : "Nenhum produto cadastrado"}
            description={
              hasFilters
                ? "Ajuste ou limpe os filtros para ver o portfólio inteiro."
                : "Cadastre o primeiro produto para começar a acompanhar o ciclo de vida, o financeiro e a execução."
            }
            action={
              !hasFilters && canCreateProduct(user) ? (
                <Button asChild size="sm">
                  <Link href="/produtos/novo">Cadastrar produto</Link>
                </Button>
              ) : null
            }
          />
        </Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {rows.map((product) => (
            <Link
              key={product.id}
              href={`/produtos/${product.id}`}
              className="card block p-4 transition-shadow hover:shadow-md"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">{product.name}</p>
                  <p className="font-mono text-[11px] text-fg-muted">{product.code}</p>
                </div>
                <Badge tone={PHASE_TONE[product.phase]}>{PHASE_LABELS[product.phase]}</Badge>
              </div>

              {product.shortDescription ? (
                <p className="mt-2 line-clamp-2 text-xs text-fg-muted">
                  {product.shortDescription}
                </p>
              ) : null}

              <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1.5 text-[11px]">
                <div>
                  <dt className="text-fg-muted">Responsável</dt>
                  <dd className="truncate">{product.ownerName ?? "—"}</dd>
                </div>
                <div>
                  <dt className="text-fg-muted">Time</dt>
                  <dd className="truncate">{product.team ?? "—"}</dd>
                </div>
                <div>
                  <dt className="text-fg-muted">Início</dt>
                  <dd>{formatDate(product.startDate)}</dd>
                </div>
                <div>
                  <dt className="text-fg-muted">
                    {product.actualLaunchDate ? "Lançado em" : "Lançamento previsto"}
                  </dt>
                  <dd>{formatDate(product.actualLaunchDate ?? product.plannedLaunchDate)}</dd>
                </div>
              </dl>

              <div className="mt-3 flex flex-wrap items-center gap-1">
                {product.status !== "active" ? (
                  <Badge tone={product.status === "paused" ? "amber" : "neutral"}>
                    {PRODUCT_STATUS_LABELS[product.status]}
                  </Badge>
                ) : null}
                {product.categoryLabel ? (
                  <Badge tone="neutral">{product.categoryLabel}</Badge>
                ) : null}
                {product.tags.slice(0, 3).map((tag) => (
                  <span key={tag} className="text-[11px] text-fg-muted">
                    #{tag}
                  </span>
                ))}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
