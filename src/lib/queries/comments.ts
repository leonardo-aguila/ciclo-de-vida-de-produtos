import { desc, eq, inArray } from "drizzle-orm";
import { db } from "@db";
import { enumValues, productComments, products, users } from "@db/schema";

export type CommentRow = {
  id: string;
  productId: string;
  productName: string;
  body: string;
  commentDate: string;
  categoryId: string | null;
  categoryLabel: string | null;
  categoryCode: string | null;
  authorId: string | null;
  authorName: string | null;
};

export async function listComments(productId: string): Promise<CommentRow[]> {
  return listCommentsFor([productId]);
}

/** Comments across many products — what the suggestion engine reads. */
export async function listCommentsFor(productIds: string[]): Promise<CommentRow[]> {
  if (productIds.length === 0) return [];

  const rows = await db
    .select({
      id: productComments.id,
      productId: productComments.productId,
      productName: products.name,
      body: productComments.body,
      commentDate: productComments.commentDate,
      categoryId: productComments.categoryId,
      categoryLabel: enumValues.label,
      categoryCode: enumValues.code,
      authorId: productComments.authorId,
      authorName: users.name,
    })
    .from(productComments)
    .innerJoin(products, eq(products.id, productComments.productId))
    .leftJoin(enumValues, eq(enumValues.id, productComments.categoryId))
    .leftJoin(users, eq(users.id, productComments.authorId))
    .where(inArray(productComments.productId, productIds))
    .orderBy(desc(productComments.commentDate));

  return rows;
}

export async function listAllComments(): Promise<CommentRow[]> {
  const ids = await db.select({ id: products.id }).from(products);
  return listCommentsFor(ids.map((row) => row.id));
}
