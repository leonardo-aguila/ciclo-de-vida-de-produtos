"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const TABS = [
  { slug: "visao-geral", label: "Visão geral" },
  // A rota continua /insights: renomear a URL quebraria links já
  // compartilhados, e o nome da aba é o que o usuário lê.
  { slug: "insights", label: "Backlog" },
  { slug: "financeiro", label: "Financeiro" },
  { slug: "tarefas", label: "Tarefas" },
  { slug: "business-plan", label: "Business Plan" },
  { slug: "comentarios", label: "Comentários" },
];

export function ProductTabs({ productId }: { productId: string }) {
  const pathname = usePathname();

  return (
    <nav aria-label="Seções do produto" className="border-b border-border">
      <ul className="-mb-px flex flex-wrap gap-1 overflow-x-auto">
        {TABS.map((tab) => {
          const href = `/produtos/${productId}/${tab.slug}`;
          const active = pathname === href;
          return (
            <li key={tab.slug}>
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "inline-block whitespace-nowrap border-b-2 px-3 py-2 text-sm transition-colors",
                  active
                    ? "border-brand font-medium text-brand"
                    : "border-transparent text-fg-muted hover:border-border hover:text-fg",
                )}
              >
                {tab.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
