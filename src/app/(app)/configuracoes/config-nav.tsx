"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const TABS = [
  { href: "/configuracoes", label: "Geral" },
  { href: "/configuracoes/dominios", label: "Domínios" },
  { href: "/configuracoes/pacotes", label: "Pacotes de tarefas" },
];

export function ConfigNav() {
  const pathname = usePathname();

  return (
    <nav aria-label="Seções de configuração" className="border-b border-border">
      <ul className="-mb-px flex flex-wrap gap-1">
        {TABS.map((tab) => {
          const active =
            tab.href === "/configuracoes" ? pathname === tab.href : pathname.startsWith(tab.href);
          return (
            <li key={tab.href}>
              <Link
                href={tab.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "inline-block border-b-2 px-3 py-2 text-sm transition-colors",
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
