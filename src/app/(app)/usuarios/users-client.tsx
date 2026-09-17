"use client";

import { KeyRound, Pencil, Plus, UserCheck, UserX } from "lucide-react";
import { useActionState, useEffect, useState } from "react";
import {
  createUserAction,
  resetPasswordAction,
  toggleUserAction,
  updateUserAction,
} from "@/app/actions/users";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Field, FormError, FormSuccess, SubmitButton } from "@/components/ui/form";
import { EmptyState } from "@/components/ui/states";
import type { ActionResult } from "@/lib/actions";
import { ROLES } from "@/lib/auth/policy";
import { MIN_PASSWORD_LENGTH } from "@/lib/defaults";
import { formatDateTime } from "@/lib/format";
import { ROLE_DESCRIPTIONS, ROLE_LABELS } from "@/lib/labels";
import type { UserRole } from "@db/schema";

type Row = {
  id: string;
  name: string;
  email: string;
  login: string;
  role: UserRole;
  active: boolean;
  lastLoginAt: Date | null;
  lockedUntil: Date | null;
  mustChangePassword: boolean;
};

const ROLE_TONES: Record<UserRole, "violet" | "blue" | "neutral" | "green"> = {
  admin: "violet",
  product_manager: "blue",
  collaborator: "green",
  executive: "neutral",
};

export function UsersClient({
  users,
  currentUserId,
}: {
  users: Row[];
  currentUserId: string;
}) {
  const [notice, setNotice] = useState<string | null>(null);

  return (
    <div className="space-y-3">
      {notice ? <FormSuccess message={notice} /> : null}

      <div className="flex justify-end">
        <UserDialog onDone={setNotice} />
      </div>

      <Card className="overflow-hidden">
        {users.length === 0 ? (
          <EmptyState
            title="Nenhum usuário cadastrado"
            description="Crie o primeiro usuário para liberar o acesso ao sistema."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Nome</th>
                  <th scope="col">Login</th>
                  <th scope="col">E-mail</th>
                  <th scope="col">Perfil</th>
                  <th scope="col">Situação</th>
                  <th scope="col">Último acesso</th>
                  <th scope="col" className="text-right">
                    Ações
                  </th>
                </tr>
              </thead>
              <tbody>
                {users.map((user) => (
                  <tr key={user.id}>
                    <td className="font-medium">{user.name}</td>
                    <td className="font-mono text-xs">{user.login}</td>
                    <td className="text-fg-muted">{user.email}</td>
                    <td>
                      <Badge tone={ROLE_TONES[user.role]}>{ROLE_LABELS[user.role]}</Badge>
                    </td>
                    <td>
                      <div className="flex flex-wrap gap-1">
                        <Badge tone={user.active ? "green" : "neutral"}>
                          {user.active ? "Ativo" : "Inativo"}
                        </Badge>
                        {user.lockedUntil && user.lockedUntil > new Date() ? (
                          <Badge tone="red">Bloqueado</Badge>
                        ) : null}
                        {user.mustChangePassword ? (
                          <Badge tone="amber">Troca pendente</Badge>
                        ) : null}
                      </div>
                    </td>
                    <td className="text-xs text-fg-muted">
                      {user.lastLoginAt ? formatDateTime(user.lastLoginAt) : "nunca acessou"}
                    </td>
                    <td>
                      <div className="flex justify-end gap-1">
                        <UserDialog user={user} onDone={setNotice} />
                        <ResetPasswordDialog user={user} onDone={setNotice} />
                        <ToggleForm
                          user={user}
                          disabled={user.id === currentUserId}
                          onDone={setNotice}
                        />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card className="p-4">
        <h2 className="text-sm font-semibold">O que cada perfil pode fazer</h2>
        <dl className="mt-2 grid gap-2 sm:grid-cols-2">
          {ROLES.map((role) => (
            <div key={role} className="rounded-lg bg-surface-muted/60 px-3 py-2">
              <dt className="text-xs font-medium text-fg">{ROLE_LABELS[role]}</dt>
              <dd className="mt-0.5 text-xs text-fg-muted">{ROLE_DESCRIPTIONS[role]}</dd>
            </div>
          ))}
        </dl>
      </Card>
    </div>
  );
}

function UserDialog({ user, onDone }: { user?: Row; onDone: (message: string) => void }) {
  const [open, setOpen] = useState(false);
  const editing = Boolean(user);
  const [state, formAction] = useActionState<ActionResult<null> | null, FormData>(
    editing ? updateUserAction : createUserAction,
    null,
  );

  useEffect(() => {
    if (state?.ok) {
      setOpen(false);
      onDone(state.message ?? "Salvo.");
    }
  }, [state, onDone]);

  const errors = state?.ok === false ? state.fieldErrors : undefined;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {editing ? (
          <Button variant="ghost" size="icon" aria-label={`Editar ${user!.name}`}>
            <Pencil className="h-4 w-4" />
          </Button>
        ) : (
          <Button size="sm">
            <Plus className="h-4 w-4" />
            Novo usuário
          </Button>
        )}
      </DialogTrigger>
      <DialogContent
        title={editing ? `Editar ${user!.name}` : "Novo usuário"}
        description={
          editing ? undefined : "A senha inicial deverá ser trocada no primeiro acesso."
        }
      >
        <form action={formAction} className="space-y-3" noValidate>
          {editing ? <input type="hidden" name="id" value={user!.id} /> : null}

          <Field label="Nome" name="name" errors={errors?.name} required>
            <input className="input" defaultValue={user?.name} required />
          </Field>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Login" name="login" errors={errors?.login} required>
              <input className="input" defaultValue={user?.login} autoCapitalize="none" required />
            </Field>
            <Field label="E-mail" name="email" errors={errors?.email} required>
              <input className="input" type="email" defaultValue={user?.email} required />
            </Field>
          </div>

          {editing ? null : (
            <Field
              label="Senha inicial"
              name="password"
              errors={errors?.password}
              hint={`Mínimo de ${MIN_PASSWORD_LENGTH} caracteres, com letra e número.`}
              required
            >
              <input className="input" type="password" autoComplete="new-password" required />
            </Field>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Perfil" name="role" errors={errors?.role} required>
              <select className="input" defaultValue={user?.role ?? "collaborator"}>
                {ROLES.map((role) => (
                  <option key={role} value={role}>
                    {ROLE_LABELS[role]}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Situação" name="active" errors={errors?.active}>
              <select className="input" defaultValue={user ? String(user.active) : "true"}>
                <option value="true">Ativo</option>
                <option value="">Inativo</option>
              </select>
            </Field>
          </div>

          {state?.ok === false ? <FormError message={state.error} /> : null}

          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="secondary" size="sm" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <SubmitButton size="sm">{editing ? "Salvar" : "Criar usuário"}</SubmitButton>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ResetPasswordDialog({ user, onDone }: { user: Row; onDone: (message: string) => void }) {
  const [open, setOpen] = useState(false);
  const [state, formAction] = useActionState<ActionResult<null> | null, FormData>(
    resetPasswordAction,
    null,
  );

  useEffect(() => {
    if (state?.ok) {
      setOpen(false);
      onDone(state.message ?? "Senha redefinida.");
    }
  }, [state, onDone]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={`Redefinir senha de ${user.name}`}>
          <KeyRound className="h-4 w-4" />
        </Button>
      </DialogTrigger>
      <DialogContent
        title={`Redefinir senha de ${user.name}`}
        description="As sessões abertas desse usuário serão encerradas."
      >
        <form action={formAction} className="space-y-3" noValidate>
          <input type="hidden" name="id" value={user.id} />
          <Field
            label="Nova senha"
            name="newPassword"
            errors={state?.ok === false ? state.fieldErrors?.newPassword : undefined}
            hint={`Mínimo de ${MIN_PASSWORD_LENGTH} caracteres, com letra e número.`}
            required
          >
            <input className="input" type="password" autoComplete="new-password" required />
          </Field>
          <label className="flex items-center gap-2 text-xs text-fg-muted">
            <input type="checkbox" name="mustChange" value="true" defaultChecked />
            Exigir troca no próximo acesso
          </label>

          {state?.ok === false ? <FormError message={state.error} /> : null}

          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="secondary" size="sm" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <SubmitButton size="sm">Redefinir</SubmitButton>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ToggleForm({
  user,
  disabled,
  onDone,
}: {
  user: Row;
  disabled: boolean;
  onDone: (message: string) => void;
}) {
  const [state, formAction] = useActionState<ActionResult<null> | null, FormData>(
    toggleUserAction,
    null,
  );

  useEffect(() => {
    if (state?.ok) onDone(state.message ?? "Atualizado.");
  }, [state, onDone]);

  return (
    <form action={formAction}>
      <input type="hidden" name="id" value={user.id} />
      <input type="hidden" name="active" value={user.active ? "" : "true"} />
      <Button
        type="submit"
        variant="ghost"
        size="icon"
        disabled={disabled}
        title={disabled ? "Você não pode desativar a própria conta" : undefined}
        aria-label={user.active ? `Desativar ${user.name}` : `Reativar ${user.name}`}
      >
        {user.active ? <UserX className="h-4 w-4" /> : <UserCheck className="h-4 w-4" />}
      </Button>
    </form>
  );
}
