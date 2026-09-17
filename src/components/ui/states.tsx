import { AlertTriangle, Inbox, Loader2 } from "lucide-react";
import * as React from "react";
import { cn } from "@/lib/utils";

/** Empty state: always says what the user can do next, never just "sem dados". */
export function EmptyState({
  title,
  description,
  action,
  icon: Icon = Inbox,
  className,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
  icon?: React.ComponentType<{ className?: string }>;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center gap-2 px-6 py-10 text-center", className)}>
      <Icon className="h-8 w-8 text-fg-muted/60" />
      <p className="text-sm font-medium text-fg">{title}</p>
      {description ? <p className="max-w-md text-xs text-fg-muted">{description}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

export function ErrorState({
  title = "Algo deu errado",
  description,
  action,
  className,
}: {
  title?: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      role="alert"
      className={cn(
        "flex flex-col items-center gap-2 rounded-xl border border-red/30 bg-red/5 px-6 py-8 text-center",
        className,
      )}
    >
      <AlertTriangle className="h-7 w-7 text-red" />
      <p className="text-sm font-medium text-fg">{title}</p>
      {description ? <p className="max-w-md text-xs text-fg-muted">{description}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn("h-4 w-4 animate-spin", className)} aria-hidden />;
}

export function LoadingState({ label = "Carregando..." }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 px-6 py-10 text-sm text-fg-muted">
      <Spinner />
      <span>{label}</span>
    </div>
  );
}

/** Grey blocks that stand in for content while a server component streams. */
export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-md bg-surface-muted", className)} />;
}
