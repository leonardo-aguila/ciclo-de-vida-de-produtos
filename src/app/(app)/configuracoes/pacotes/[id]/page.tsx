import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Button } from "@/components/ui/button";
import { listEnumValues } from "@/lib/queries/enums";
import { getPackage, getPackageTemplates } from "@/lib/queries/packages";
import { listProductOwners } from "@/lib/queries/products";
import { TemplateEditor } from "./template-editor";

export const dynamic = "force-dynamic";

export default async function PackageEditorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const pkg = await getPackage(id);
  if (!pkg) notFound();

  const [templates, categories, columns, owners] = await Promise.all([
    getPackageTemplates(id),
    listEnumValues("task_category"),
    listEnumValues("kanban_column"),
    listProductOwners(),
  ]);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Button asChild variant="ghost" size="sm">
          <Link href="/configuracoes/pacotes">
            <ArrowLeft className="h-4 w-4" />
            Pacotes
          </Link>
        </Button>
        <h2 className="text-sm font-semibold">{pkg.name}</h2>
      </div>

      <TemplateEditor
        packageId={pkg.id}
        templates={templates.map((template) => ({
          id: template.id,
          name: template.name,
          description: template.description,
          categoryId: template.categoryId,
          defaultAssigneeId: template.defaultAssigneeId,
          priority: template.priority,
          initialStatus: template.initialStatus,
          estimatedHours: template.estimatedHours,
          anchor: template.anchor,
          startOffsetDays: template.startOffsetDays,
          endOffsetDays: template.endOffsetDays,
          orderIndex: template.orderIndex,
          dependsOn: template.dependsOn,
        }))}
        categories={categories.map((c) => ({ id: c.id, label: c.label }))}
        columns={columns.map((c) => ({ code: c.code, label: c.label }))}
        owners={owners.map((o) => ({ id: o.id, label: o.name }))}
      />
    </div>
  );
}
