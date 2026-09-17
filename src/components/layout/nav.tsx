"use client";

import {
  BarChart3,
  Boxes,
  LogOut,
  Settings,
  Users,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

type NavItem = {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  /** Roles allowed to see the link; the server still enforces access. */
  roles?: string[];
};

const ITEMS: NavItem[] = [
  { href: "/", label: "Painel executivo", icon: BarChart3 },
  { href: "/produtos", label: "Produtos", icon: Boxes },
  { href: "/configuracoes", label: "Configurações", icon: Settings, roles: ["admin"] },
  { href: "/usuarios", label: "Usuários", icon: Users, roles: ["admin"] },
];

export function Nav({
  role,
  userName,
}: {
  role: string;
  userName: string;
}) {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Navegação principal"
      className="flex h-full flex-col gap-1 border-r border-border bg-surface px-3 py-4"
    >
      <div className="mb-4 px-2">
        <span className="text-sm font-semibold tracking-tight">portfolio</span>
        <p className="text-[11px] text-fg-muted">ciclo de vida de produtos</p>
      </div>

      <ul className="flex flex-1 flex-col gap-0.5">
        {ITEMS.filter((item) => !item.roles || item.roles.includes(role)).map((item) => {
          const active =
            item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-colors",
                  active
                    ? "bg-brand/10 font-medium text-brand"
                    : "text-fg-muted hover:bg-surface-muted hover:text-fg",
                )}
              >
                <item.icon className="h-4 w-4 shrink-0" />
                <span className="truncate">{item.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>

      <div className="mt-2 border-t border-border pt-3">
        <p className="truncate px-2.5 text-xs font-medium text-fg">{userName}</p>
        <form action="/api/sair" method="post">
          <button
            type="submit"
            className="mt-1 flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-fg-muted transition-colors hover:bg-surface-muted hover:text-fg"
          >
            <LogOut className="h-4 w-4" />
            Sair
          </button>
        </form>
      </div>
    </nav>
  );
}
