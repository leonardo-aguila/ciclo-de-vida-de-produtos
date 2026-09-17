import { asc, eq, sql } from "drizzle-orm";
import { db } from "@db";
import { taskPackages, taskTemplateDependencies, taskTemplates } from "@db/schema";

export async function listPackages(onlyActive = true) {
  return db
    .select({
      id: taskPackages.id,
      name: taskPackages.name,
      description: taskPackages.description,
      targetPhase: taskPackages.targetPhase,
      active: taskPackages.active,
      // The outer column must be qualified: an unqualified `id` inside the
      // subquery binds to task_templates and the correlation silently breaks.
      taskCount: sql<number>`(select count(*)::int from task_templates t where t.package_id = task_packages.id)`,
    })
    .from(taskPackages)
    .where(onlyActive ? eq(taskPackages.active, true) : undefined)
    .orderBy(asc(taskPackages.name));
}

export async function getPackage(id: string) {
  const [pkg] = await db.select().from(taskPackages).where(eq(taskPackages.id, id)).limit(1);
  return pkg ?? null;
}

export async function getPackageTemplates(packageId: string) {
  const templates = await db
    .select()
    .from(taskTemplates)
    .where(eq(taskTemplates.packageId, packageId))
    .orderBy(asc(taskTemplates.orderIndex));

  const dependencies = await db.select().from(taskTemplateDependencies);
  const ids = new Set(templates.map((t) => t.id));

  return templates.map((template) => ({
    ...template,
    dependsOn: dependencies
      .filter((dep) => dep.templateId === template.id && ids.has(dep.dependsOnTemplateId))
      .map((dep) => dep.dependsOnTemplateId),
  }));
}
