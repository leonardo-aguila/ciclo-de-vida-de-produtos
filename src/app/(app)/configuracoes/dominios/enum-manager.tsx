"use client";

import { Check, Plus, Trash2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useState } from "react";
import {
  deleteEnumValueAction,
  reorderEnumValuesAction,
  saveEnumValueAction,
} from "@/app/actions/config";
import { SortableList } from "@/components/sortable-list";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { FormError, FormSuccess } from "@/components/ui/form";
import type { ActionResult } from "@/lib/actions";
import type { EnumKind } from "@db/schema";

type Value = {
  id: string;
  code: string;
  label: string;
  color: string | null;
  active: boolean;
  isSystem: boolean;
  sortOrder: number;
};

export function EnumManager({
  kind,
  title,
  description,
  values: initial,
}: {
  kind: EnumKind;
  title: string;
  description?: string;
  values: Value[];
}) {
  const router = useRouter();
  const [values, setValues] = useState(initial);
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => setValues(initial), [initial]);

  async function persistOrder(ordered: Value[]) {
    setValues(ordered);
    const form = new FormData();
    form.set("kind", kind);
    form.set("order", JSON.stringify(ordered.map((value) => value.id)));
    const result = await reorderEnumValuesAction(null, form);
    if (!result.ok) {
      // Put the previous order back: the list must not claim a change the
      // server refused.
      setValues(initial);
      setNotice(null);
    } else {
      router.refresh();
    }
  }

  return (
    <Card>
      <CardHeader
        title={title}
        description={description}
        action={
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => setEditing(editing === "new" ? null : "new")}
          >
            <Plus className="h-4 w-4" />
            Novo valor
          </Button>
        }
      />
      <CardBody className="space-y-2">
        {notice ? <FormSuccess message={notice} /> : null}

        {editing === "new" ? (
          <ValueForm
            kind={kind}
            nextOrder={values.length + 1}
            onDone={(message) => {
              setEditing(null);
              setNotice(message);
              router.refresh();
            }}
            onCancel={() => setEditing(null)}
          />
        ) : null}

        {values.length === 0 ? (
          <p className="py-4 text-center text-xs text-fg-muted">
            Nenhum valor cadastrado. Crie o primeiro para que este domínio apareça nos formulários.
          </p>
        ) : (
          <SortableList
            items={values}
            onReorder={persistOrder}
            renderItem={(value) =>
              editing === value.id ? (
                <ValueForm
                  kind={kind}
                  value={value}
                  nextOrder={value.sortOrder}
                  onDone={(message) => {
                    setEditing(null);
                    setNotice(message);
                    router.refresh();
                  }}
                  onCancel={() => setEditing(null)}
                />
              ) : (
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    {value.color ? (
                      <span
                        className="h-3 w-3 shrink-0 rounded-full border border-border"
                        style={{ backgroundColor: value.color }}
                        aria-hidden
                      />
                    ) : null}
                    <span className="truncate text-sm font-medium">{value.label}</span>
                    <code className="text-[11px] text-fg-muted">{value.code}</code>
                    {value.isSystem ? <Badge tone="violet">Do sistema</Badge> : null}
                    {!value.active ? <Badge tone="neutral">Inativo</Badge> : null}
                  </div>
                  <div className="flex gap-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setEditing(value.id)}
                    >
                      Editar
                    </Button>
                    <DeleteValue
                      value={value}
                      onDone={(message) => {
                        setNotice(message);
                        router.refresh();
                      }}
                    />
                  </div>
                </div>
              )
            }
          />
        )}
      </CardBody>
    </Card>
  );
}

function ValueForm({
  kind,
  value,
  nextOrder,
  onDone,
  onCancel,
}: {
  kind: EnumKind;
  value?: Value;
  nextOrder: number;
  onDone: (message: string) => void;
  onCancel: () => void;
}) {
  const [state, formAction] = useActionState<ActionResult<null> | null, FormData>(
    saveEnumValueAction,
    null,
  );

  useEffect(() => {
    if (state?.ok) onDone(state.message ?? "Salvo.");
  }, [state, onDone]);

  const errors = state?.ok === false ? state.fieldErrors : undefined;

  return (
    <form action={formAction} className="grid gap-2 sm:grid-cols-12" noValidate>
      <input type="hidden" name="kind" value={kind} />
      <input type="hidden" name="sortOrder" value={nextOrder} />
      {value ? <input type="hidden" name="id" value={value.id} /> : null}

      <div className="sm:col-span-4">
        <label className="label" htmlFor={`label-${value?.id ?? "new"}`}>
          Rótulo
        </label>
        <input
          id={`label-${value?.id ?? "new"}`}
          name="label"
          className="input"
          defaultValue={value?.label}
          autoFocus
        />
        {errors?.label ? <p className="field-error">{errors.label[0]}</p> : null}
      </div>

      <div className="sm:col-span-3">
        <label className="label" htmlFor={`code-${value?.id ?? "new"}`}>
          Código
        </label>
        <input
          id={`code-${value?.id ?? "new"}`}
          name="code"
          className="input font-mono text-xs"
          defaultValue={value?.code}
          disabled={value?.isSystem}
        />
        {value?.isSystem ? (
          <input type="hidden" name="code" value={value.code} />
        ) : null}
        {errors?.code ? <p className="field-error">{errors.code[0]}</p> : null}
      </div>

      <div className="sm:col-span-2">
        <label className="label" htmlFor={`color-${value?.id ?? "new"}`}>
          Cor
        </label>
        <input
          id={`color-${value?.id ?? "new"}`}
          name="color"
          type="color"
          className="input h-9 p-1"
          defaultValue={value?.color ?? "#64748b"}
        />
      </div>

      <div className="sm:col-span-2">
        <label className="label" htmlFor={`active-${value?.id ?? "new"}`}>
          Situação
        </label>
        <select
          id={`active-${value?.id ?? "new"}`}
          name="active"
          className="input"
          defaultValue={value ? String(value.active) : "true"}
        >
          <option value="true">Ativo</option>
          <option value="">Inativo</option>
        </select>
      </div>

      <div className="flex items-end gap-1 sm:col-span-1">
        <Button type="submit" size="icon" aria-label="Salvar valor">
          <Check className="h-4 w-4" />
        </Button>
        <Button type="button" variant="ghost" size="icon" aria-label="Cancelar" onClick={onCancel}>
          <X className="h-4 w-4" />
        </Button>
      </div>

      {state?.ok === false ? (
        <div className="sm:col-span-12">
          <FormError message={state.error} />
        </div>
      ) : null}
    </form>
  );
}

function DeleteValue({ value, onDone }: { value: Value; onDone: (message: string) => void }) {
  const [state, formAction] = useActionState<ActionResult<null> | null, FormData>(
    deleteEnumValueAction,
    null,
  );

  useEffect(() => {
    if (state?.ok) onDone(state.message ?? "Excluído.");
  }, [state, onDone]);

  return (
    <form action={formAction} className="flex items-center gap-2">
      <input type="hidden" name="id" value={value.id} />
      <Button
        type="submit"
        variant="ghost"
        size="icon"
        disabled={value.isSystem}
        aria-label={`Excluir ${value.label}`}
        title={value.isSystem ? "Valor do sistema: desative em vez de excluir" : undefined}
      >
        <Trash2 className="h-4 w-4" />
      </Button>
      {state?.ok === false ? (
        <span className="max-w-xs text-[11px] text-red">{state.error}</span>
      ) : null}
    </form>
  );
}
