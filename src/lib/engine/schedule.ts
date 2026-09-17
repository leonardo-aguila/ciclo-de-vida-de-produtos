/**
 * Schedule engine — pure functions, no database.
 *
 * Turns a task package into dated tasks, and answers the scheduling questions
 * the overview asks: how much is done, how late it is, and which chain of tasks
 * actually decides the launch date.
 */
import { addDaysToIso, daysBetween } from "@/lib/format";

/* -------------------------------------------------------------------------- */
/* Applying a task package                                                    */
/* -------------------------------------------------------------------------- */

export type TaskAnchorKind = "start_date" | "planned_launch_date";

export type TemplateInput = {
  id: string;
  name: string;
  description?: string | null;
  categoryId?: string | null;
  defaultAssigneeId?: string | null;
  priority: "low" | "medium" | "high" | "critical";
  initialStatus: string;
  estimatedHours?: number | null;
  anchor: TaskAnchorKind;
  startOffsetDays: number;
  endOffsetDays: number;
  orderIndex: number;
  parentTemplateId?: string | null;
  dependsOn?: string[];
};

export type AnchorDates = {
  startDate: string;
  plannedLaunchDate?: string | null;
};

export type PlannedTask = {
  templateId: string;
  name: string;
  description: string | null;
  categoryId: string | null;
  assigneeId: string | null;
  priority: TemplateInput["priority"];
  status: string;
  estimatedHours: number | null;
  startDate: string;
  dueDate: string;
  orderIndex: number;
  parentTemplateId: string | null;
  dependsOn: string[];
};

export type PlanResult = {
  tasks: PlannedTask[];
  /** Things the user must be told about — shown above the preview. */
  warnings: string[];
};

/**
 * Computes the dates of every task in a package from the product's anchors.
 *
 * A template anchored on the launch date when the product has none falls back
 * to the start date: producing no task at all would silently drop work from the
 * plan, which is worse than producing one on a date the user can correct.
 */
export function planTasksFromPackage(
  templates: TemplateInput[],
  anchors: AnchorDates,
): PlanResult {
  const warnings: string[] = [];
  let missingLaunchAnchor = 0;

  const ordered = [...templates].sort((a, b) => a.orderIndex - b.orderIndex);

  const tasks = ordered.map((template, index) => {
    let base = anchors.startDate;
    if (template.anchor === "planned_launch_date") {
      if (anchors.plannedLaunchDate) {
        base = anchors.plannedLaunchDate;
      } else {
        missingLaunchAnchor += 1;
      }
    }

    const startDate = addDaysToIso(base, template.startOffsetDays);
    let dueDate = addDaysToIso(base, template.endOffsetDays);

    // An end before the start is a misconfigured template, not a valid task.
    if (daysBetween(startDate, dueDate) < 0) {
      dueDate = startDate;
      warnings.push(
        `A tarefa "${template.name}" tinha conclusão antes do início; a data de conclusão foi igualada à de início.`,
      );
    }

    return {
      templateId: template.id,
      name: template.name,
      description: template.description ?? null,
      categoryId: template.categoryId ?? null,
      assigneeId: template.defaultAssigneeId ?? null,
      priority: template.priority,
      status: template.initialStatus,
      estimatedHours: template.estimatedHours ?? null,
      startDate,
      dueDate,
      orderIndex: index,
      parentTemplateId: template.parentTemplateId ?? null,
      dependsOn: template.dependsOn ?? [],
    };
  });

  if (missingLaunchAnchor > 0) {
    warnings.unshift(
      missingLaunchAnchor === 1
        ? "1 tarefa é ancorada na data prevista de lançamento, que não foi informada; ela foi calculada a partir da data de início."
        : `${missingLaunchAnchor} tarefas são ancoradas na data prevista de lançamento, que não foi informada; elas foram calculadas a partir da data de início.`,
    );
  }

  return { tasks, warnings };
}

/**
 * Names that already exist on the product. Applying a package to a product that
 * already has tasks should warn, not silently duplicate work.
 */
export function findDuplicateNames(existingNames: string[], planned: PlannedTask[]): string[] {
  const existing = new Set(existingNames.map((name) => name.trim().toLowerCase()));
  return planned
    .filter((task) => existing.has(task.name.trim().toLowerCase()))
    .map((task) => task.name);
}

/* -------------------------------------------------------------------------- */
/* Progress and schedule deviation                                            */
/* -------------------------------------------------------------------------- */

export type TaskProgressInput = {
  id: string;
  progress: number;
  estimatedHours?: number | null;
  startDate?: string | null;
  dueDate?: string | null;
  doneDate?: string | null;
  status: string;
};

/**
 * Overall completion, weighted by estimated hours when they exist.
 *
 * Weighting by hours is what keeps a two-hour task from counting as much as a
 * two-week one. With no estimates anywhere it falls back to a simple average,
 * which is the honest reading of "we don't know the sizes".
 */
export function overallProgress(tasks: TaskProgressInput[]): number {
  if (tasks.length === 0) return 0;

  const totalWeight = tasks.reduce((sum, task) => sum + (task.estimatedHours ?? 0), 0);
  if (totalWeight <= 0) {
    return tasks.reduce((sum, task) => sum + task.progress, 0) / tasks.length;
  }

  const weighted = tasks.reduce(
    (sum, task) => sum + task.progress * (task.estimatedHours ?? 0),
    0,
  );
  return weighted / totalWeight;
}

export function isLate(task: TaskProgressInput, today: string): boolean {
  if (!task.dueDate) return false;
  if (task.progress >= 100 || task.doneDate) return false;
  return daysBetween(task.dueDate, today) > 0;
}

export function countLateTasks(tasks: TaskProgressInput[], today: string): number {
  return tasks.filter((task) => isLate(task, today)).length;
}

/** Open tasks due within `days` — the "próximos vencimentos" list. */
export function dueWithin(tasks: TaskProgressInput[], today: string, days: number) {
  return tasks.filter((task) => {
    if (!task.dueDate || task.progress >= 100 || task.doneDate) return false;
    const remaining = daysBetween(today, task.dueDate);
    return remaining >= 0 && remaining <= days;
  });
}

/**
 * Expected completion if the project ran evenly between its first start and its
 * last due date. It is the yardstick the execution health component uses.
 */
export function expectedProgress(tasks: TaskProgressInput[], today: string): number {
  const starts = tasks.map((t) => t.startDate).filter((d): d is string => Boolean(d));
  const ends = tasks.map((t) => t.dueDate).filter((d): d is string => Boolean(d));
  if (starts.length === 0 || ends.length === 0) return 0;

  const first = starts.reduce((min, date) => (date < min ? date : min), starts[0]!);
  const last = ends.reduce((max, date) => (date > max ? date : max), ends[0]!);

  const total = daysBetween(first, last);
  if (total <= 0) return today >= last ? 100 : 0;

  const elapsed = daysBetween(first, today);
  return Math.max(0, Math.min(100, (elapsed / total) * 100));
}

/**
 * Planned vs. actual completion over time — the S-curve.
 * Planned assumes each task accrues evenly between its start and due dates.
 */
export function sCurve(
  tasks: TaskProgressInput[],
  dates: string[],
): { date: string; planned: number; actual: number }[] {
  const weight = (task: TaskProgressInput) => task.estimatedHours ?? 1;
  const totalWeight = tasks.reduce((sum, task) => sum + weight(task), 0);
  if (totalWeight <= 0 || dates.length === 0) {
    return dates.map((date) => ({ date, planned: 0, actual: 0 }));
  }

  return dates.map((date) => {
    let planned = 0;
    let actual = 0;

    for (const task of tasks) {
      const w = weight(task) / totalWeight;

      if (task.startDate && task.dueDate) {
        const span = daysBetween(task.startDate, task.dueDate);
        const elapsed = daysBetween(task.startDate, date);
        const share = span <= 0 ? (elapsed >= 0 ? 1 : 0) : Math.max(0, Math.min(1, elapsed / span));
        planned += w * share;
      }

      // Actual only counts what was finished by this date; work in progress
      // without a completion date cannot be dated backwards.
      if (task.doneDate && task.doneDate <= date) {
        actual += w;
      } else if (!task.doneDate && date >= (task.dueDate ?? date)) {
        actual += (w * task.progress) / 100;
      }
    }

    return {
      date,
      planned: Math.round(planned * 1000) / 10,
      actual: Math.round(actual * 1000) / 10,
    };
  });
}

/** Days between the planned launch and the date the schedule actually points to. */
export function scheduleDeviationDays(
  plannedLaunchDate: string | null | undefined,
  tasks: TaskProgressInput[],
): number | null {
  if (!plannedLaunchDate) return null;
  const ends = tasks.map((t) => t.dueDate).filter((d): d is string => Boolean(d));
  if (ends.length === 0) return null;
  const last = ends.reduce((max, date) => (date > max ? date : max), ends[0]!);
  return daysBetween(plannedLaunchDate, last);
}

/* -------------------------------------------------------------------------- */
/* Critical path                                                              */
/* -------------------------------------------------------------------------- */

export type CpmTask = {
  id: string;
  startDate: string | null;
  dueDate: string | null;
  dependsOn: string[];
};

/**
 * Critical path by CPM: a forward pass for the earliest dates, a backward pass
 * for the latest, and zero slack marks the chain that moves the end date.
 *
 * Tasks without dates cannot be placed on the timeline and are left out rather
 * than defaulted to today, which would invent a path that does not exist.
 */
export function criticalPath(tasks: CpmTask[]): {
  criticalIds: Set<string>;
  slackByTask: Map<string, number>;
} {
  const dated = tasks.filter((task) => task.startDate && task.dueDate);
  const byId = new Map(dated.map((task) => [task.id, task]));
  const slackByTask = new Map<string, number>();
  if (dated.length === 0) return { criticalIds: new Set(), slackByTask };

  const duration = (task: CpmTask) => Math.max(0, daysBetween(task.startDate!, task.dueDate!));

  // Topological order; a dependency cycle leaves the remaining tasks unsorted,
  // and they are then treated as having no predecessors.
  const indegree = new Map<string, number>();
  const dependents = new Map<string, string[]>();
  for (const task of dated) {
    const deps = task.dependsOn.filter((id) => byId.has(id));
    indegree.set(task.id, deps.length);
    for (const dep of deps) {
      dependents.set(dep, [...(dependents.get(dep) ?? []), task.id]);
    }
  }

  const queue = dated.filter((task) => (indegree.get(task.id) ?? 0) === 0).map((t) => t.id);
  const order: string[] = [];
  while (queue.length > 0) {
    const id = queue.shift()!;
    order.push(id);
    for (const next of dependents.get(id) ?? []) {
      const remaining = (indegree.get(next) ?? 0) - 1;
      indegree.set(next, remaining);
      if (remaining === 0) queue.push(next);
    }
  }
  for (const task of dated) if (!order.includes(task.id)) order.push(task.id);

  // Everything is measured in days from the earliest start in the project.
  const origin = dated.reduce(
    (min, task) => (task.startDate! < min ? task.startDate! : min),
    dated[0]!.startDate!,
  );

  const earliestStart = new Map<string, number>();
  const earliestFinish = new Map<string, number>();
  for (const id of order) {
    const task = byId.get(id)!;
    const own = daysBetween(origin, task.startDate!);
    const fromDeps = task.dependsOn
      .filter((dep) => byId.has(dep))
      .map((dep) => earliestFinish.get(dep) ?? 0);
    const start = Math.max(own, ...(fromDeps.length > 0 ? fromDeps : [own]));
    earliestStart.set(id, start);
    earliestFinish.set(id, start + duration(task));
  }

  const projectEnd = Math.max(...Array.from(earliestFinish.values()));

  const latestFinish = new Map<string, number>();
  const latestStart = new Map<string, number>();
  for (const id of [...order].reverse()) {
    const task = byId.get(id)!;
    const successors = dependents.get(id) ?? [];
    const finish =
      successors.length === 0
        ? projectEnd
        : Math.min(...successors.map((next) => latestStart.get(next) ?? projectEnd));
    latestFinish.set(id, finish);
    latestStart.set(id, finish - duration(task));
  }

  const criticalIds = new Set<string>();
  for (const id of order) {
    const slack = (latestFinish.get(id) ?? 0) - (earliestFinish.get(id) ?? 0);
    slackByTask.set(id, slack);
    if (slack <= 0) criticalIds.add(id);
  }

  return { criticalIds, slackByTask };
}
