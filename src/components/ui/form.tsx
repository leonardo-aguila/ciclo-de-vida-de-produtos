"use client";

import { AlertCircle, CheckCircle2 } from "lucide-react";
import * as React from "react";
import { useFormStatus } from "react-dom";
import { Button, type ButtonProps } from "@/components/ui/button";
import { Spinner } from "@/components/ui/states";
import { cn } from "@/lib/utils";

/** A labelled field that renders its own error, tied by aria-describedby. */
export function Field({
  label,
  name,
  errors,
  hint,
  required,
  children,
  className,
}: {
  label: string;
  name: string;
  errors?: string[];
  hint?: string;
  required?: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  const errorId = `${name}-error`;
  const hintId = `${name}-hint`;
  const hasError = Boolean(errors?.length);

  return (
    <div className={cn("min-w-0", className)}>
      <label className="label" htmlFor={name}>
        {label}
        {required ? <span className="ml-0.5 text-red">*</span> : null}
      </label>
      {React.isValidElement(children)
        ? React.cloneElement(children as React.ReactElement<Record<string, unknown>>, {
            id: name,
            name,
            "aria-invalid": hasError || undefined,
            "aria-describedby":
              [hasError ? errorId : null, hint ? hintId : null].filter(Boolean).join(" ") ||
              undefined,
          })
        : children}
      {hint ? (
        <p id={hintId} className="mt-1 text-[11px] text-fg-muted">
          {hint}
        </p>
      ) : null}
      {hasError ? (
        <p id={errorId} className="field-error">
          {errors?.[0]}
        </p>
      ) : null}
    </div>
  );
}

export function FormError({ message }: { message?: string | null }) {
  if (!message) return null;
  return (
    <p
      role="alert"
      className="flex items-start gap-2 rounded-lg border border-red/30 bg-red/5 px-3 py-2 text-xs text-red"
    >
      <AlertCircle className="mt-px h-3.5 w-3.5 shrink-0" />
      <span>{message}</span>
    </p>
  );
}

export function FormSuccess({ message }: { message?: string | null }) {
  if (!message) return null;
  return (
    <p
      role="status"
      className="flex items-start gap-2 rounded-lg border border-green/30 bg-green/5 px-3 py-2 text-xs text-green"
    >
      <CheckCircle2 className="mt-px h-3.5 w-3.5 shrink-0" />
      <span>{message}</span>
    </p>
  );
}

/** Submit button that disables and shows progress while the action runs. */
export function SubmitButton({
  children,
  pendingLabel,
  ...props
}: ButtonProps & { pendingLabel?: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending || props.disabled} {...props}>
      {pending ? <Spinner /> : null}
      {pending ? (pendingLabel ?? "Salvando...") : children}
    </Button>
  );
}
