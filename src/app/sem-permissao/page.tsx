import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/states";

export default function ForbiddenPage() {
  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <ErrorState
        title="Acesso não permitido"
        description="Seu perfil não tem acesso a esta área. Se precisar dela, peça ao administrador."
        action={
          <Button asChild size="sm" variant="secondary">
            <Link href="/">Voltar ao painel</Link>
          </Button>
        }
      />
    </div>
  );
}
