import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/guard";
import { canEditProduct, canManageInsights } from "@/lib/auth/policy";
import { listEnumValues } from "@/lib/queries/enums";
import { listInsights } from "@/lib/queries/insights";
import { getProduct, listProductOwners } from "@/lib/queries/products";
import { InsightsClient } from "./insights-client";

export const dynamic = "force-dynamic";

export default async function InsightsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  const product = await getProduct(id);
  if (!product) notFound();

  const [insights, origins, people, categories] = await Promise.all([
    listInsights(id),
    listEnumValues("insight_origin"),
    listProductOwners(),
    listEnumValues("task_category"),
  ]);

  return (
    <InsightsClient
      productId={product.id}
      insights={insights}
      origins={origins.map((origin) => ({ id: origin.id, label: origin.label }))}
      people={people.map((person) => ({ id: person.id, label: person.name }))}
      categories={categories.map((category) => ({ id: category.id, label: category.label }))}
      canEdit={canManageInsights(user, product)}
      canManageProduct={canEditProduct(user, product)}
    />
  );
}
