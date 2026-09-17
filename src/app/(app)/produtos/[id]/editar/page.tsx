import { notFound, redirect } from "next/navigation";
import { ProductForm } from "@/app/(app)/produtos/product-form";
import { requireUser } from "@/lib/auth/guard";
import { canEditProduct } from "@/lib/auth/policy";
import { listEnumValues } from "@/lib/queries/enums";
import { listPackages } from "@/lib/queries/packages";
import { getProduct, getProductGoals, listProductOwners } from "@/lib/queries/products";

export const dynamic = "force-dynamic";

export default async function EditProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  const product = await getProduct(id);
  if (!product) notFound();
  if (!canEditProduct(user, product)) redirect("/sem-permissao");

  const [goals, goalTypes, categories, owners, packages] = await Promise.all([
    getProductGoals(id),
    listEnumValues("goal_type"),
    listEnumValues("product_category"),
    listProductOwners(),
    listPackages(),
  ]);

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <header>
        <h1 className="text-lg font-semibold">Editar {product.name}</h1>
      </header>

      <ProductForm
        product={{
          id: product.id,
          name: product.name,
          code: product.code,
          shortDescription: product.shortDescription,
          ownerId: product.ownerId,
          team: product.team,
          categoryId: product.categoryId,
          phase: product.phase,
          status: product.status,
          startDate: product.startDate,
          plannedLaunchDate: product.plannedLaunchDate,
          actualLaunchDate: product.actualLaunchDate,
          segment: product.segment,
          pricingModel: product.pricingModel,
          competitors: product.competitors,
          tags: product.tags,
        }}
        goals={goals.map((goal) => ({
          goalTypeId: goal.goalTypeId,
          targetValue: goal.targetValue,
          unit: goal.unit,
          period: goal.period,
          deadline: goal.deadline,
          isPrimary: goal.isPrimary,
        }))}
        goalTypes={goalTypes.map((v) => ({ id: v.id, label: v.label, meta: v.meta }))}
        categories={categories.map((v) => ({ id: v.id, label: v.label }))}
        owners={owners}
        packages={packages.map((p) => ({ id: p.id, name: p.name, taskCount: p.taskCount }))}
      />
    </div>
  );
}
