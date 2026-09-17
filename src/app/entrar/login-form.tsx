"use client";

import { useActionState } from "react";
import { signInAction } from "@/app/actions/auth";
import { Card, CardBody } from "@/components/ui/card";
import { Field, FormError, SubmitButton } from "@/components/ui/form";

export function LoginForm({ redirectTo }: { redirectTo?: string }) {
  const [state, formAction] = useActionState(signInAction, null);

  return (
    <Card>
      <CardBody>
        <form action={formAction} className="space-y-4" noValidate>
          {redirectTo ? <input type="hidden" name="redirectTo" value={redirectTo} /> : null}

          <Field label="Login" name="login" errors={state?.ok === false ? state.fieldErrors?.login : undefined} required>
            <input
              className="input"
              type="text"
              autoComplete="username"
              autoCapitalize="none"
              autoFocus
              required
            />
          </Field>

          <Field
            label="Senha"
            name="password"
            errors={state?.ok === false ? state.fieldErrors?.password : undefined}
            required
          >
            <input className="input" type="password" autoComplete="current-password" required />
          </Field>

          {state?.ok === false ? <FormError message={state.error} /> : null}

          <SubmitButton className="w-full" pendingLabel="Entrando...">
            Entrar
          </SubmitButton>
        </form>
      </CardBody>
    </Card>
  );
}
