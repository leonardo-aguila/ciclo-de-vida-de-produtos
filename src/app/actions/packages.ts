"use server";

import { asc, eq, inArray, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@db";
import { taskPackages, taskTemplateDependencies, taskTemplates } from "@db/schema";
import { fail, ok, parseForm, toActionError, type ActionResult } from "@/lib/actions";
import { writeAudit } from "@/lib/audit";
import { authorize, requireUserOrThrow } from "@/lib/auth/guard";
import { canManageTaskPackages } from "@/lib/auth/policy";
import {
  deletePackageSchema,
  deleteTemplateSchema,
  duplicatePackageSchema,
  packageSchema,
  reorderTemplatesSchema,
  templateSchema,
} from "@/lib/schemas/config";

async function requirePackageAdmin() {
  const actor = await requireUserOrThrow();
  authorize(canManageTaskPackages(actor), "Apenas administradores gerenciam pacotes de tarefas.");
  return actor;
}

export async function savePackageAction(
  _prev: ActionResult<{ id: string } | null> | null,
  formData: FormData,
): Promise<ActionResult<{ id: string } | null>> {
  try {
    const actor = await requirePackageAdmin();
    const parsed = parseForm(packageSchema, formData);
    if (!parsed.ok) return parsed.result;
    const input = parsed.data;

    if (input.id) {
      await db
        .update(taskPackages)
        .set({
          name: input.name,
          description: input.description,
          targetPhase: input.targetPhase,
          active: input.active,
          updatedAt: new Date(),
        })
        .where(eq(taskPackages.id, input.id));

      await writeAudit({
        entityType: "task_package",
        entityId: input.id,
        action: "update",
        actorId: actor.id,
        changes: [{ field: "name", to: input.name }],
      });

      revalidatePath("/configuracoes/pacotes");
      return ok({ id: input.id }, "Pacote atualizado.");
    }

    const [created] = await db
      .insert(taskPackages)
      .values({
        name: input.name,
        description: input.description,
        targetPhase: input.targetPhase,
        active: input.active,
      })
      .returning({ id: taskPackages.id });

    await writeAudit({
      entityType: "task_package",
      entityId: created!.id,
      action: "create",
      actorId: actor.id,
      changes: [{ field: "name", to: input.name }],
    });

    revalidatePath("/configuracoes/pacotes");
    return ok({ id: created!.id }, "Pacote criado.");
  } catch (error) {
    return toActionError(error);
  }
}

export async function duplicatePackageAction(
  _prev: ActionResult<{ id: string } | null> | null,
  formData: FormData,
): Promise<ActionResult<{ id: string } | null>> {
  try {
    const actor = await requirePackageAdmin();
    const parsed = parseForm(duplicatePackageSchema, formData);
    if (!parsed.ok) return parsed.result;

    const [source] = await db
      .select()
      .from(taskPackages)
      .where(eq(taskPackages.id, parsed.data.id))
      .limit(1);
    if (!source) return fail("Pacote não encontrado.");

    const [copy] = await db
      .insert(taskPackages)
      .values({
        name: `${source.name} (cópia)`,
        description: source.description,
        targetPhase: source.targetPhase,
        active: source.active,
      })
      .returning({ id: taskPackages.id });

    const templates = await db
      .select()
      .from(taskTemplates)
      .where(eq(taskTemplates.packageId, source.id))
      .orderBy(asc(taskTemplates.orderIndex));

    if (templates.length > 0) {
      const inserted = await db
        .insert(taskTemplates)
        .values(
          templates.map((template) => ({
            packageId: copy!.id,
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
          })),
        )
        .returning({ id: taskTemplates.id });

      // Map old template ids to new ones so dependencies survive the copy.
      const idMap = new Map(templates.map((template, index) => [template.id, inserted[index]!.id]));

      const deps = await db
        .select()
        .from(taskTemplateDependencies)
        .where(
          inArray(
            taskTemplateDependencies.templateId,
            templates.map((t) => t.id),
          ),
        );

      const newDeps = deps
        .map((dep) => ({
          templateId: idMap.get(dep.templateId),
          dependsOnTemplateId: idMap.get(dep.dependsOnTemplateId),
        }))
        .filter((dep) => dep.templateId && dep.dependsOnTemplateId)
        .map((dep) => ({
          templateId: dep.templateId!,
          dependsOnTemplateId: dep.dependsOnTemplateId!,
        }));

      if (newDeps.length > 0) await db.insert(taskTemplateDependencies).values(newDeps);

      // Parent links follow the same map.
      for (const template of templates) {
        if (!template.parentTemplateId) continue;
        const child = idMap.get(template.id);
        const parent = idMap.get(template.parentTemplateId);
        if (child && parent) {
          await db
            .update(taskTemplates)
            .set({ parentTemplateId: parent })
            .where(eq(taskTemplates.id, child));
        }
      }
    }

    await writeAudit({
      entityType: "task_package",
      entityId: copy!.id,
      action: "create",
      actorId: actor.id,
      changes: [{ field: "name", to: `cópia de ${source.name}` }],
    });

    revalidatePath("/configuracoes/pacotes");
    return ok({ id: copy!.id }, `Pacote duplicado com ${templates.length} tarefas.`);
  } catch (error) {
    return toActionError(error);
  }
}

export async function deletePackageAction(
  _prev: ActionResult<null> | null,
  formData: FormData,
): Promise<ActionResult<null>> {
  try {
    const actor = await requirePackageAdmin();
    const parsed = parseForm(deletePackageSchema, formData);
    if (!parsed.ok) return parsed.result;

    const [pkg] = await db
      .select()
      .from(taskPackages)
      .where(eq(taskPackages.id, parsed.data.id))
      .limit(1);
    if (!pkg) return fail("Pacote não encontrado.");

    await writeAudit({
      entityType: "task_package",
      entityId: pkg.id,
      action: "delete",
      actorId: actor.id,
      changes: [{ field: "name", from: pkg.name, to: null }],
    });

    // Tasks already created from this package keep living: they only carry the
    // template id, and it is nulled on delete.
    await db.delete(taskPackages).where(eq(taskPackages.id, pkg.id));

    revalidatePath("/configuracoes/pacotes");
    return ok(null, `Pacote "${pkg.name}" excluído.`);
  } catch (error) {
    return toActionError(error);
  }
}

export async function saveTemplateAction(
  _prev: ActionResult<null> | null,
  formData: FormData,
): Promise<ActionResult<null>> {
  try {
    const actor = await requirePackageAdmin();
    const parsed = parseForm(templateSchema, formData);
    if (!parsed.ok) return parsed.result;
    const input = parsed.data;

    let templateId = input.id;

    if (templateId) {
      // A template cannot depend on itself; that would be a cycle of one.
      const dependsOn = input.dependsOn.filter((id) => id !== templateId);

      await db
        .update(taskTemplates)
        .set({
          name: input.name,
          description: input.description,
          categoryId: input.categoryId,
          defaultAssigneeId: input.defaultAssigneeId,
          priority: input.priority,
          initialStatus: input.initialStatus,
          estimatedHours: input.estimatedHours,
          anchor: input.anchor,
          startOffsetDays: input.startOffsetDays,
          endOffsetDays: input.endOffsetDays,
        })
        .where(eq(taskTemplates.id, templateId));

      await db
        .delete(taskTemplateDependencies)
        .where(eq(taskTemplateDependencies.templateId, templateId));
      if (dependsOn.length > 0) {
        await db.insert(taskTemplateDependencies).values(
          dependsOn.map((dependsOnTemplateId) => ({
            templateId: templateId!,
            dependsOnTemplateId,
          })),
        );
      }
    } else {
      const [maxOrder] = await db
        .select({ max: sql<number>`coalesce(max(${taskTemplates.orderIndex}), 0)::int` })
        .from(taskTemplates)
        .where(eq(taskTemplates.packageId, input.packageId));

      const [created] = await db
        .insert(taskTemplates)
        .values({
          packageId: input.packageId,
          name: input.name,
          description: input.description,
          categoryId: input.categoryId,
          defaultAssigneeId: input.defaultAssigneeId,
          priority: input.priority,
          initialStatus: input.initialStatus,
          estimatedHours: input.estimatedHours,
          anchor: input.anchor,
          startOffsetDays: input.startOffsetDays,
          endOffsetDays: input.endOffsetDays,
          orderIndex: (maxOrder?.max ?? 0) + 1,
        })
        .returning({ id: taskTemplates.id });

      templateId = created!.id;
      if (input.dependsOn.length > 0) {
        await db.insert(taskTemplateDependencies).values(
          input.dependsOn.map((dependsOnTemplateId) => ({
            templateId: templateId!,
            dependsOnTemplateId,
          })),
        );
      }
    }

    await writeAudit({
      entityType: "task_template",
      entityId: templateId!,
      action: input.id ? "update" : "create",
      actorId: actor.id,
      changes: [{ field: "name", to: input.name }],
    });

    revalidatePath(`/configuracoes/pacotes/${input.packageId}`);
    return ok(null, input.id ? "Tarefa-modelo atualizada." : "Tarefa-modelo criada.");
  } catch (error) {
    return toActionError(error);
  }
}

export async function deleteTemplateAction(
  _prev: ActionResult<null> | null,
  formData: FormData,
): Promise<ActionResult<null>> {
  try {
    const actor = await requirePackageAdmin();
    const parsed = parseForm(deleteTemplateSchema, formData);
    if (!parsed.ok) return parsed.result;

    const [template] = await db
      .select()
      .from(taskTemplates)
      .where(eq(taskTemplates.id, parsed.data.id))
      .limit(1);
    if (!template) return fail("Tarefa-modelo não encontrada.");

    await db.delete(taskTemplates).where(eq(taskTemplates.id, template.id));

    await writeAudit({
      entityType: "task_template",
      entityId: template.id,
      action: "delete",
      actorId: actor.id,
      changes: [{ field: "name", from: template.name, to: null }],
    });

    revalidatePath(`/configuracoes/pacotes/${template.packageId}`);
    return ok(null, `"${template.name}" removida do pacote.`);
  } catch (error) {
    return toActionError(error);
  }
}

export async function reorderTemplatesAction(
  _prev: ActionResult<null> | null,
  formData: FormData,
): Promise<ActionResult<null>> {
  try {
    await requirePackageAdmin();
    const parsed = parseForm(reorderTemplatesSchema, formData);
    if (!parsed.ok) return parsed.result;

    await Promise.all(
      parsed.data.order.map((id, index) =>
        db.update(taskTemplates).set({ orderIndex: index + 1 }).where(eq(taskTemplates.id, id)),
      ),
    );

    revalidatePath(`/configuracoes/pacotes/${parsed.data.packageId}`);
    return ok(null, "Ordem salva.");
  } catch (error) {
    return toActionError(error);
  }
}
