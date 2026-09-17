"use client";

import { Copy, Plus, Settings2, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useState } from "react";
import {
  deletePackageAction,
  duplicatePackageAction,
  savePackageAction,
} from "@/app/actions/packages";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Field, FormError, FormSuccess, SubmitButton } from "@/components/ui/form";
import { EmptyState } from "@/components/ui/states";
import type { ActionResult } from "@/lib/actions";
import { PHASE_LABELS, PHASE_ORDER } from "@/lib/labels";
import type { LifecyclePhase } from "@db/schema";

type Pkg = {
  id: string;
  name: string;
  description: string | null;
  targetPhase: LifecyclePhase | null;
  active: boolean;
  taskCount: number;
};

export function PackageList({ packages }: { packages: Pkg[] }) {
  const [notice, setNotice] = useState<string | null>(null);

  return (
    <div className="space-y-3">
      {notice ? <FormSuccess message={notice} /> : null}

      <div className="flex justify-end">
        <PackageDialog onDone={setNotice} />
      </div>

      {packages.length === 0 ? (
        <Card>
          <EmptyState
            title="Nenhum pacote cadastrado"
            description="Um pacote guarda as tarefas-modelo que serão replicadas quando um produto for criado, com as datas calculadas a partir de uma âncora."
          />
        </Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {packages.map((pkg) => (
            <Card key={pkg.id} className="p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">{pkg.name}</p>
                  <p className="mt-0.5 text-xs text-fg-muted">
                    {pkg.taskCount} {pkg.taskCount === 1 ? "tarefa-modelo" : "tarefas-modelo"}
                    {pkg.targetPhase ? ` · ${PHASE_LABELS[pkg.targetPhase]}` : ""}
                  </p>
                </div>
                {!pkg.active ? <Badge tone="neutral">Inativo</Badge> : null}
              </div>

              {pkg.description ? (
                <p className="mt-2 line-clamp-2 text-xs text-fg-muted">{pkg.description}</p>
              ) : null}

              <div className="mt-3 flex flex-wrap gap-1">
                <Button asChild variant="secondary" size="sm">
                  <Link href={`/configuracoes/pacotes/${pkg.id}`}>
                    <Settings2 className="h-4 w-4" />
                    Editar tarefas
                  </Link>
                </Button>
                <PackageDialog pkg={pkg} onDone={setNotice} />
                <DuplicateButton id={pkg.id} onDone={setNotice} />
                <DeleteButton pkg={pkg} onDone={setNotice} />
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function PackageDialog({ pkg, onDone }: { pkg?: Pkg; onDone: (message: string) => void }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [state, formAction] = useActionState<ActionResult<{ id: string } | null> | null, FormData>(
    savePackageAction,
    null,
  );

  useEffect(() => {
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
        {pkg ? (
          <Button variant="ghost" size="sm">
            Renomear
          </Button>
        ) : (
          <Button size="sm">
            <Plus className="h-4 w-4" />
            Novo pacote
          </Button>
        )}
      </DialogTrigger>
      <DialogContent title={pkg ? `Editar ${pkg.name}` : "Novo pacote"}>
        <form action={formAction} className="space-y-3" noValidate>
          {pkg ? <input type="hidden" name="id" value={pkg.id} /> : null}

          <Field label="Nome" name="name" errors={errors?.name} required>
            <input className="input" defaultValue={pkg?.name} />
          </Field>
          <Field label="Descrição" name="description" errors={errors?.description}>
            <textarea className="input" rows={2} defaultValue={pkg?.description ?? ""} />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Fase a que se destina" name="targetPhase" errors={errors?.targetPhase}>
              <select className="input" defaultValue={pkg?.targetPhase ?? ""}>
                <option value="">Qualquer fase</option>
                {PHASE_ORDER.map((phase) => (
                  <option key={phase} value={phase}>
                    {PHASE_LABELS[phase]}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Situação" name="active" errors={errors?.active}>
              <select className="input" defaultValue={pkg ? String(pkg.active) : "true"}>
                <option value="true">Ativo</option>
                <option value="">Inativo</option>
              </select>
            </Field>
          </div>

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

function DuplicateButton({ id, onDone }: { id: string; onDone: (message: string) => void }) {
  const router = useRouter();
  const [state, formAction] = useActionState<ActionResult<{ id: string } | null> | null, FormData>(
    duplicatePackageAction,
    null,
  );

  useEffect(() => {
    if (state?.ok) {
      onDone(state.message ?? "Duplicado.");
      router.refresh();
    }
  }, [state, onDone, router]);

  return (
    <form action={formAction}>
      <input type="hidden" name="id" value={id} />
      <Button type="submit" variant="ghost" size="sm">
        <Copy className="h-4 w-4" />
        Duplicar
      </Button>
    </form>
  );
}

function DeleteButton({ pkg, onDone }: { pkg: Pkg; onDone: (message: string) => void }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [state, formAction] = useActionState<ActionResult<null> | null, FormData>(
    deletePackageAction,
    null,
  );

  useEffect(() => {
    if (state?.ok) {
      setOpen(false);
      onDone(state.message ?? "Excluído.");
      router.refresh();
    }
  }, [state, onDone, router]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm">
          <Trash2 className="h-4 w-4" />
          Excluir
        </Button>
      </DialogTrigger>
      <DialogContent
        title={`Excluir ${pkg.name}?`}
        description="As tarefas já criadas em produtos a partir deste pacote continuam existindo."
      >
        <form action={formAction} className="space-y-3">
          <input type="hidden" name="id" value={pkg.id} />
          {state?.ok === false ? <FormError message={state.error} /> : null}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" size="sm" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <SubmitButton size="sm" variant="danger">
              Excluir pacote
            </SubmitButton>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
