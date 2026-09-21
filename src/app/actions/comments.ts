"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@db";
import { productComments } from "@db/schema";
import { fail, ok, parseForm, toActionError, type ActionResult } from "@/lib/actions";
import { authorize, requireUserOrThrow } from "@/lib/auth/guard";
import { canComment, canEditComment } from "@/lib/auth/policy";
import { getProductRef } from "@/lib/queries/products";
import { commentSchema, deleteCommentSchema } from "@/lib/schemas/comment";

export async function saveCommentAction(
  _prev: ActionResult<null> | null,
  formData: FormData,
): Promise<ActionResult<null>> {
  try {
    const actor = await requireUserOrThrow();
    const parsed = parseForm(commentSchema, formData);
    if (!parsed.ok) return parsed.result;
    const input = parsed.data;

    const product = await getProductRef(input.productId);
    if (!product) return fail("Produto não encontrado.");
    authorize(canComment(actor), "Seu perfil tem acesso somente de leitura.");

    if (input.id) {
      const [current] = await db
        .select()
        .from(productComments)
        .where(eq(productComments.id, input.id))
        .limit(1);
      if (!current) return fail("Comentário não encontrado.");
      // Editing someone else's comment would rewrite what they said.
      authorize(canEditComment(actor, current), "Você só edita os próprios comentários.");

      await db
        .update(productComments)
        .set({
          categoryId: input.categoryId,
          body: input.body,
          commentDate: input.commentDate,
        })
        .where(eq(productComments.id, input.id));
    } else {
      await db.insert(productComments).values({
        productId: input.productId,
        authorId: actor.id,
        categoryId: input.categoryId,
        body: input.body,
        commentDate: input.commentDate,
      });
    }

    revalidatePath(`/produtos/${input.productId}/comentarios`);
    revalidatePath("/");
    return ok(null, input.id ? "Comentário atualizado." : "Comentário registrado.");
  } catch (error) {
    return toActionError(error);
  }
}

export async function deleteCommentAction(
  _prev: ActionResult<null> | null,
  formData: FormData,
): Promise<ActionResult<null>> {
  try {
    const actor = await requireUserOrThrow();
    const parsed = parseForm(deleteCommentSchema, formData);
    if (!parsed.ok) return parsed.result;

    const [comment] = await db
      .select()
      .from(productComments)
      .where(eq(productComments.id, parsed.data.id))
      .limit(1);
    if (!comment) return fail("Comentário não encontrado.");
    authorize(canEditComment(actor, comment), "Você só exclui os próprios comentários.");

    await db.delete(productComments).where(eq(productComments.id, comment.id));

    revalidatePath(`/produtos/${comment.productId}/comentarios`);
    revalidatePath("/");
    return ok(null, "Comentário excluído.");
  } catch (error) {
    return toActionError(error);
  }
}
