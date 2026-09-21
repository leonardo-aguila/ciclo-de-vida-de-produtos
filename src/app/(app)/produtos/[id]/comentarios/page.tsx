import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/guard";
import { canComment, isAdmin } from "@/lib/auth/policy";
import { listComments } from "@/lib/queries/comments";
import { listEnumValues } from "@/lib/queries/enums";
import { getProduct } from "@/lib/queries/products";
import { CommentsClient } from "./comments-client";

export const dynamic = "force-dynamic";

export default async function CommentsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  const product = await getProduct(id);
  if (!product) notFound();

  const [comments, categories] = await Promise.all([
    listComments(id),
    listEnumValues("comment_category"),
  ]);

  return (
    <CommentsClient
      productId={product.id}
      comments={comments}
      categories={categories.map((category) => ({
        id: category.id,
        label: category.label,
        color: category.color,
      }))}
      canWrite={canComment(user)}
      currentUserId={user.id}
      isAdmin={isAdmin(user)}
    />
  );
}
