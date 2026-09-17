"use client";

import { useActionState } from "react";
import { changePasswordAction } from "@/app/actions/auth";
import { Field, FormError, FormSuccess, SubmitButton } from "@/components/ui/form";
import { MIN_PASSWORD_LENGTH } from "@/lib/defaults";

export function ChangePasswordForm() {
  const [state, formAction] = useActionState(changePasswordAction, null);
  const errors = state?.ok === false ? state.fieldErrors : undefined;

  return (
    <form action={formAction} className="max-w-sm space-y-3" noValidate>
      <Field label="Senha atual" name="currentPassword" errors={errors?.currentPassword} required>
        <input className="input" type="password" autoComplete="current-password" required />
      </Field>
      <Field
        label="Nova senha"
        name="newPassword"
        errors={errors?.newPassword}
        hint={`Mínimo de ${MIN_PASSWORD_LENGTH} caracteres, com letra e número.`}
        required
      >
        <input className="input" type="password" autoComplete="new-password" required />
      </Field>
      <Field label="Repita a nova senha" name="confirmPassword" errors={errors?.confirmPassword} required>
        <input className="input" type="password" autoComplete="new-password" required />
      </Field>

      {state?.ok === false ? <FormError message={state.error} /> : null}
      {state?.ok ? <FormSuccess message={state.message} /> : null}

      <SubmitButton size="sm">Trocar senha</SubmitButton>
    </form>
  );
}
