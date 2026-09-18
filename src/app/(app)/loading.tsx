import { Skeleton } from "@/components/ui/states";

/**
 * Loading state for the authenticated area.
 *
 * It lives inside `(app)`, not at the root: a root-level loading.tsx wraps the
 * whole document, so the navigation is replaced by a spinner and the streamed
 * content arrives in a hidden node that React then has to reconcile — which
 * shows up as a hydration mismatch on every page.
 */
export default function Loading() {
  return (
    <div className="space-y-4" aria-busy="true" aria-live="polite">
      <span className="sr-only">Carregando...</span>
      <Skeleton className="h-7 w-64" />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Skeleton className="h-24" />
        <Skeleton className="h-24" />
        <Skeleton className="h-24" />
        <Skeleton className="h-24" />
      </div>
      <Skeleton className="h-64" />
    </div>
  );
}
