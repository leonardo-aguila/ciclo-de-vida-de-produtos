"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/states";

/** Catches render errors so the user never gets a blank screen. */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] items-center justify-center p-6">
      <ErrorState
        title="Não foi possível carregar esta página"
        description={
          error.digest
            ? `Tente novamente. Se persistir, informe o código ${error.digest} ao administrador.`
            : "Tente novamente. Se persistir, informe o administrador."
        }
        action={
          <Button variant="secondary" size="sm" onClick={reset}>
            Tentar de novo
          </Button>
        }
      />
    </div>
  );
}
