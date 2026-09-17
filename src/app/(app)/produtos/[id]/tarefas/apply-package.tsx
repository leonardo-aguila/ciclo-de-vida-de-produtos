"use client";

import { PackagePlus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useState } from "react";
import { applyPackageAction } from "@/app/actions/products";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { FormError, FormSuccess, SubmitButton } from "@/components/ui/form";
import type { ActionResult } from "@/lib/actions";

export function ApplyPackage({
  productId,
  packages,
}: {
  productId: string;
  packages: { id: string; name: string; taskCount: number }[];
}) {
  const router = useRouter();
  const [state, formAction] = useActionState<ActionResult<{ created: number } | null> | null, FormData>(
    applyPackageAction,
    null,
  );
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    if (state?.ok) {
      setConfirming(false);
      router.refresh();
    }
    // A duplicate-name warning is the one failure the user can override.
    if (state?.ok === false && state.fieldErrors?.confirmDuplicates) setConfirming(true);
  }, [state, router]);

  if (packages.length === 0) return null;

  return (
    <Card>
      <CardHeader
        title="Aplicar pacote padrão"
        description="As tarefas do pacote são acrescentadas; nada do que já existe é apagado."
      />
      <CardBody>
        <form action={formAction} className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="productId" value={productId} />
          {confirming ? <input type="hidden" name="confirmDuplicates" value="true" /> : null}

          <div className="min-w-[16rem] flex-1">
            <label className="label" htmlFor="packageId">
              Pacote
            </label>
            <select id="packageId" name="packageId" className="input" defaultValue="">
              <option value="" disabled>
                Selecione um pacote
              </option>
              {packages.map((pkg) => (
                <option key={pkg.id} value={pkg.id}>
                  {pkg.name} ({pkg.taskCount} {pkg.taskCount === 1 ? "tarefa" : "tarefas"})
                </option>
              ))}
            </select>
          </div>

          <SubmitButton size="sm" variant={confirming ? "danger" : "primary"}>
            <PackagePlus className="h-4 w-4" />
            {confirming ? "Aplicar mesmo assim" : "Aplicar"}
          </SubmitButton>
        </form>

        <div className="mt-2 space-y-2">
          {state?.ok === false ? <FormError message={state.error} /> : null}
          {state?.ok ? <FormSuccess message={state.message} /> : null}
        </div>
      </CardBody>
    </Card>
  );
}
