/**
 * Authorization rules, in one place, as pure functions.
 *
 * The UI calls these to decide what to render; the server calls the same
 * functions before every mutation. Hiding a button is a convenience — the
 * server check is the actual defense.
 */
import type { User, UserRole } from "@db/schema";

/** Just enough of a product to decide ownership. */
export type ProductRef = { id: string; ownerId: string | null };
/** Just enough of a task to decide assignment. */
export type TaskRef = { assigneeId: string | null; productId: string };

export type Actor = Pick<User, "id" | "role" | "active">;

export function isAdmin(user: Actor): boolean {
  return user.role === "admin";
}

/** Executives are read-only everywhere, by definition of the role. */
export function isReadOnly(user: Actor): boolean {
  return user.role === "executive";
}

export function canManageUsers(user: Actor): boolean {
  return isAdmin(user);
}

export function canManageSettings(user: Actor): boolean {
  return isAdmin(user);
}

/** Task packages are part of the configuration surface. */
export function canManageTaskPackages(user: Actor): boolean {
  return isAdmin(user);
}

export function canCreateProduct(user: Actor): boolean {
  return user.role === "admin" || user.role === "product_manager";
}

/** Owning the product is what gives a product manager write access to it. */
export function canEditProduct(user: Actor, product: ProductRef): boolean {
  if (isAdmin(user)) return true;
  if (user.role === "product_manager") return product.ownerId === user.id;
  return false;
}

export function canDeleteProduct(user: Actor, product: ProductRef): boolean {
  return canEditProduct(user, product);
}

/**
 * A collaborator edits the tasks assigned to them; the product owner edits any
 * task of their product.
 */
export function canEditTask(user: Actor, task: TaskRef, product: ProductRef): boolean {
  if (canEditProduct(user, product)) return true;
  if (user.role === "collaborator") return task.assigneeId === user.id;
  return false;
}

export function canCreateTask(user: Actor, product: ProductRef): boolean {
  return canEditProduct(user, product);
}

/** Comments and insights are how collaborators contribute; executives only read. */
export function canComment(user: Actor): boolean {
  return !isReadOnly(user);
}

export function canEditComment(user: Actor, comment: { authorId: string | null }): boolean {
  if (isAdmin(user)) return true;
  return comment.authorId === user.id && !isReadOnly(user);
}

export function canManageInsights(user: Actor, product: ProductRef): boolean {
  if (canEditProduct(user, product)) return true;
  return user.role === "collaborator";
}

/** Finance, business plan and the continuity decision follow product ownership. */
export function canWriteFinance(user: Actor, product: ProductRef): boolean {
  return canEditProduct(user, product);
}

export function canWriteBusinessPlan(user: Actor, product: ProductRef): boolean {
  return canEditProduct(user, product);
}

export function canRegisterDecision(user: Actor, product: ProductRef): boolean {
  return canEditProduct(user, product);
}

/** Every active user reads everything; the executive dashboard included. */
export function canRead(user: Actor): boolean {
  return user.active;
}

export const ROLES: UserRole[] = ["admin", "product_manager", "collaborator", "executive"];
