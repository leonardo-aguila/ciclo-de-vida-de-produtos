"use client";

import { MessageSquare, Pencil, Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import * as React from "react";
import { deleteCommentAction, saveCommentAction } from "@/app/actions/comments";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Field, FormError, FormSuccess, SubmitButton } from "@/components/ui/form";
import { EmptyState } from "@/components/ui/states";
import type { ActionResult } from "@/lib/actions";
import { formatDate, todayIso } from "@/lib/format";
import type { CommentRow } from "@/lib/queries/comments";

type Option = { id: string; label: string; color: string | null };

export function CommentsClient({
  productId,
  comments,
  categories,
  canWrite,
  currentUserId,
  isAdmin,
}: {
  productId: string;
  comments: CommentRow[];
  categories: Option[];
  canWrite: boolean;
  currentUserId: string;
  isAdmin: boolean;
}) {
  const [notice, setNotice] = React.useState<string | null>(null);
  const [categoryFilter, setCategoryFilter] = React.useState("");

  const visible = React.useMemo(
    () => comments.filter((comment) => !categoryFilter || comment.categoryId === categoryFilter),
    [comments, categoryFilter],
  );

  return (
    <div className="space-y-3">
      {notice ? <FormSuccess message={notice} /> : null}

      <Card>
        <CardHeader
          title="Comentários"
          description="Registro datado do que se ouve sobre o produto. É este texto que alimenta as sugestões do painel executivo."
          action={
            canWrite ? (
              <CommentDialog productId={productId} categories={categories} onDone={setNotice} />
            ) : null
          }
        />
        <CardBody className="space-y-3">
          {categories.length > 0 && comments.length > 0 ? (
            <div className="max-w-xs">
              <label className="label" htmlFor="comment-category">
                Filtrar por categoria
              </label>
              <select
                id="comment-category"
                className="input"
                value={categoryFilter}
                onChange={(event) => setCategoryFilter(event.target.value)}
              >
                <option value="">Todas</option>
                {categories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.label}
                  </option>
                ))}
              </select>
            </div>
          ) : null}

          {visible.length === 0 ? (
            <EmptyState
              icon={MessageSquare}
              title={comments.length === 0 ? "Nenhum comentário" : "Nenhum comentário nessa categoria"}
              description={
                comments.length === 0
                  ? "Registre o que chega de cliente, de vendas, de suporte e da concorrência. Quando um tema se repetir, ele vira sugestão no painel executivo."
                  : "Troque o filtro para ver os demais."
              }
            />
          ) : (
            <ul className="space-y-3">
              {visible.map((comment) => {
                const mine = comment.authorId === currentUserId;
                return (
                  <li key={comment.id} className="border-b border-border pb-3 last:border-0 last:pb-0">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <p className="flex flex-wrap items-center gap-2 text-[11px] text-fg-muted">
                        <span className="font-medium text-fg">{comment.authorName ?? "—"}</span>
                        {formatDate(comment.commentDate)}
                        {comment.categoryLabel ? (
                          <span
                            className="rounded-full px-1.5 py-0.5"
                            style={{
                              backgroundColor: `${
                                categories.find((c) => c.id === comment.categoryId)?.color ?? "#64748b"
                              }1a`,
                              color:
                                categories.find((c) => c.id === comment.categoryId)?.color ??
                                undefined,
                            }}
                          >
                            {comment.categoryLabel}
                          </span>
                        ) : (
                          <Badge tone="neutral">Sem categoria</Badge>
                        )}
                      </p>
                      {canWrite && (mine || isAdmin) ? (
                        <div className="flex gap-1">
                          <CommentDialog
                            productId={productId}
                            comment={comment}
                            categories={categories}
                            onDone={setNotice}
                          />
                          <DeleteComment comment={comment} onDone={setNotice} />
                        </div>
                      ) : null}
                    </div>
                    <p className="mt-1 whitespace-pre-line text-sm">{comment.body}</p>
                  </li>
                );
              })}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  );
}

function CommentDialog({
  productId,
  comment,
  categories,
  onDone,
}: {
  productId: string;
  comment?: CommentRow;
  categories: Option[];
  onDone: (message: string) => void;
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [state, formAction] = React.useActionState<ActionResult<null> | null, FormData>(
    saveCommentAction,
    null,
  );

  React.useEffect(() => {
    if (state?.ok) {
      setOpen(false);
      onDone(state.message ?? "Salvo.");
      router.refresh();
    }
  }, [state, onDone, router]);

  const errors = state?.ok === false ? state.fieldErrors : undefined;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {comment ? (
          <Button variant="ghost" size="icon" aria-label="Editar comentário">
            <Pencil className="h-4 w-4" />
          </Button>
        ) : (
          <Button size="sm">
            <Plus className="h-4 w-4" />
            Novo comentário
          </Button>
        )}
      </DialogTrigger>
      <DialogContent title={comment ? "Editar comentário" : "Novo comentário"}>
        <form action={formAction} className="space-y-3" noValidate>
          <input type="hidden" name="productId" value={productId} />
          {comment ? <input type="hidden" name="id" value={comment.id} /> : null}

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Data" name="commentDate" errors={errors?.commentDate} required>
              <input
                className="input"
                type="date"
                defaultValue={comment?.commentDate ?? todayIso()}
              />
            </Field>
            <Field label="Categoria" name="categoryId" errors={errors?.categoryId}>
              <select className="input" defaultValue={comment?.categoryId ?? ""}>
                <option value="">Sem categoria</option>
                {categories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.label}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <Field
            label="Comentário"
            name="body"
            errors={errors?.body}
            hint="Escreva como falaria: o motor de sugestões agrupa por semelhança de texto."
            required
          >
            <textarea className="input" rows={5} defaultValue={comment?.body} />
          </Field>

          {state?.ok === false ? <FormError message={state.error} /> : null}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" size="sm" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <SubmitButton size="sm">Salvar</SubmitButton>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function DeleteComment({
  comment,
  onDone,
}: {
  comment: CommentRow;
  onDone: (message: string) => void;
}) {
  const router = useRouter();
  const [state, formAction] = React.useActionState<ActionResult<null> | null, FormData>(
    deleteCommentAction,
    null,
  );

  React.useEffect(() => {
    if (state?.ok) {
      onDone(state.message ?? "Excluído.");
      router.refresh();
    }
  }, [state, onDone, router]);

  return (
    <form action={formAction}>
      <input type="hidden" name="id" value={comment.id} />
      <Button type="submit" variant="ghost" size="icon" aria-label="Excluir comentário">
        <Trash2 className="h-4 w-4" />
      </Button>
    </form>
  );
}
