import Link from "next/link";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/states";

export default function NotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <EmptyState
        title="Página não encontrada"
        description="O endereço acessado não existe ou o item foi removido."
        action={
          <Button asChild size="sm" variant="secondary">
            <Link href="/">Ir para o painel</Link>
          </Button>
        }
      />
    </div>
  );
}
