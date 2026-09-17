"use client";

import { Search, X } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { PHASE_LABELS, PHASE_ORDER, PRODUCT_STATUS_LABELS } from "@/lib/labels";

type Option = { id: string; label: string };

/** Filters live in the URL, so a filtered view can be linked and reloaded. */
export function ProductFilters({
  owners,
  categories,
}: {
  owners: Option[];
  categories: Option[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const [search, setSearch] = useState(params.get("busca") ?? "");

  function apply(key: string, value: string) {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    startTransition(() => router.replace(`${pathname}?${next.toString()}`));
  }

  // Debounced free-text search: one navigation per pause, not per keystroke.
  useEffect(() => {
    const current = params.get("busca") ?? "";
    if (search === current) return;
    const timer = setTimeout(() => apply("busca", search), 350);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const hasFilters = Array.from(params.keys()).length > 0;

  return (
    <div className="flex flex-wrap items-end gap-2" data-pending={isPending || undefined}>
      <div className="min-w-[12rem] flex-1">
        <label className="label" htmlFor="busca">
          Buscar
        </label>
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-fg-muted" />
          <input
            id="busca"
            className="input pl-8"
            placeholder="Nome ou código"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
      </div>

      <div>
        <label className="label" htmlFor="fase">
          Fase
        </label>
        <select
          id="fase"
          className="input"
          value={params.get("fase") ?? ""}
          onChange={(event) => apply("fase", event.target.value)}
        >
          <option value="">Todas</option>
          {PHASE_ORDER.map((phase) => (
            <option key={phase} value={phase}>
              {PHASE_LABELS[phase]}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="label" htmlFor="situacao">
          Situação
        </label>
        <select
          id="situacao"
          className="input"
          value={params.get("situacao") ?? ""}
          onChange={(event) => apply("situacao", event.target.value)}
        >
          <option value="">Todas</option>
          {(["active", "paused", "discontinued"] as const).map((status) => (
            <option key={status} value={status}>
              {PRODUCT_STATUS_LABELS[status]}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="label" htmlFor="responsavel">
          Responsável
        </label>
        <select
          id="responsavel"
          className="input"
          value={params.get("responsavel") ?? ""}
          onChange={(event) => apply("responsavel", event.target.value)}
        >
          <option value="">Todos</option>
          {owners.map((owner) => (
            <option key={owner.id} value={owner.id}>
              {owner.label}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="label" htmlFor="categoria">
          Categoria
        </label>
        <select
          id="categoria"
          className="input"
          value={params.get("categoria") ?? ""}
          onChange={(event) => apply("categoria", event.target.value)}
        >
          <option value="">Todas</option>
          {categories.map((category) => (
            <option key={category.id} value={category.id}>
              {category.label}
            </option>
          ))}
        </select>
      </div>

      {hasFilters ? (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setSearch("");
            startTransition(() => router.replace(pathname));
          }}
        >
          <X className="h-4 w-4" />
          Limpar
        </Button>
      ) : null}
    </div>
  );
}
