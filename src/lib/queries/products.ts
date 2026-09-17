import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@db";
import {
  enumValues,
  productGoals,
  productPhaseHistory,
  products,
  users,
  type LifecyclePhase,
  type Product,
} from "@db/schema";

export type ProductListRow = {
  id: string;
  code: string;
  name: string;
  shortDescription: string | null;
  phase: LifecyclePhase;
  status: Product["status"];
  startDate: string;
  plannedLaunchDate: string | null;
  actualLaunchDate: string | null;
  team: string | null;
  tags: string[];
  ownerId: string | null;
  ownerName: string | null;
  categoryLabel: string | null;
};

export type ProductFilters = {
  phase?: LifecyclePhase;
  status?: Product["status"];
  ownerId?: string;
  categoryId?: string;
  search?: string;
};

export async function listProducts(filters: ProductFilters = {}): Promise<ProductListRow[]> {
  const conditions = [];
  if (filters.phase) conditions.push(eq(products.phase, filters.phase));
  if (filters.status) conditions.push(eq(products.status, filters.status));
  if (filters.ownerId) conditions.push(eq(products.ownerId, filters.ownerId));
  if (filters.categoryId) conditions.push(eq(products.categoryId, filters.categoryId));
  if (filters.search) {
    const term = `%${filters.search.trim().toLowerCase()}%`;
    conditions.push(
      sql`(lower(${products.name}) like ${term} or lower(${products.code}) like ${term})`,
    );
  }

  return db
    .select({
      id: products.id,
      code: products.code,
      name: products.name,
      shortDescription: products.shortDescription,
      phase: products.phase,
      status: products.status,
      startDate: products.startDate,
      plannedLaunchDate: products.plannedLaunchDate,
      actualLaunchDate: products.actualLaunchDate,
      team: products.team,
      tags: products.tags,
      ownerId: products.ownerId,
      ownerName: users.name,
      categoryLabel: enumValues.label,
    })
    .from(products)
    .leftJoin(users, eq(users.id, products.ownerId))
    .leftJoin(enumValues, eq(enumValues.id, products.categoryId))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(asc(products.name));
}

export async function getProduct(id: string) {
  const [product] = await db.select().from(products).where(eq(products.id, id)).limit(1);
  return product ?? null;
}

/** Just enough of the product for the authorization check. */
export async function getProductRef(id: string) {
  const [row] = await db
    .select({ id: products.id, ownerId: products.ownerId })
    .from(products)
    .where(eq(products.id, id))
    .limit(1);
  return row ?? null;
}

export async function getProductGoals(productId: string) {
  return db
    .select({
      id: productGoals.id,
      goalTypeId: productGoals.goalTypeId,
      goalTypeLabel: enumValues.label,
      goalTypeCode: enumValues.code,
      targetValue: productGoals.targetValue,
      unit: productGoals.unit,
      period: productGoals.period,
      deadline: productGoals.deadline,
      isPrimary: productGoals.isPrimary,
    })
    .from(productGoals)
    .leftJoin(enumValues, eq(enumValues.id, productGoals.goalTypeId))
    .where(eq(productGoals.productId, productId))
    .orderBy(desc(productGoals.isPrimary), asc(productGoals.createdAt));
}

export async function getPrimaryGoal(productId: string) {
  const goals = await getProductGoals(productId);
  return goals.find((goal) => goal.isPrimary) ?? null;
}

export async function getPhaseHistory(productId: string) {
  return db
    .select()
    .from(productPhaseHistory)
    .where(eq(productPhaseHistory.productId, productId))
    .orderBy(asc(productPhaseHistory.startedAt));
}

/** Phase history of many products at once — the portfolio average needs it. */
export async function getPhaseHistoryFor(productIds: string[]) {
  if (productIds.length === 0) return [];
  return db
    .select()
    .from(productPhaseHistory)
    .where(inArray(productPhaseHistory.productId, productIds))
    .orderBy(asc(productPhaseHistory.startedAt));
}

export async function listProductOwners() {
  return db
    .select({ id: users.id, name: users.name, role: users.role })
    .from(users)
    .where(eq(users.active, true))
    .orderBy(asc(users.name));
}
