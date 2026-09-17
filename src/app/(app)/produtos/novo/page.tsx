import { redirect } from "next/navigation";
import { ProductForm } from "@/app/(app)/produtos/product-form";
import { requireUser } from "@/lib/auth/guard";
import { canCreateProduct } from "@/lib/auth/policy";
import { listEnumValues } from "@/lib/queries/enums";
import { listPackages } from "@/lib/queries/packages";
import { listProductOwners } from "@/lib/queries/products";

export const metadata = { title: "Novo produto — portfolio" };
export const dynamic = "force-dynamic";

export default async function NewProductPage() {
  const user = await requireUser();
  if (!canCreateProduct(user)) redirect("/sem-permissao");

  const [goalTypes, categories, owners, packages] = await Promise.all([
    listEnumValues("goal_type"),
    listEnumValues("product_category"),
    listProductOwners(),
    listPackages(),
  ]);

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <header>
        <h1 className="text-lg font-semibold">Novo produto</h1>
        <p className="text-sm text-fg-muted">
          Se escolher um pacote padrão, as tarefas são criadas junto, já datadas.
        </p>
      </header>

      <ProductForm
        goalTypes={goalTypes.map((v) => ({ id: v.id, label: v.label, meta: v.meta }))}
        categories={categories.map((v) => ({ id: v.id, label: v.label }))}
        owners={owners}
        packages={packages.map((p) => ({ id: p.id, name: p.name, taskCount: p.taskCount }))}
      />
    </div>
  );
}
