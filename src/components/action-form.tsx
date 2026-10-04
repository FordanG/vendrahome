"use client";

import { startTransition, useActionState, useEffect, useRef, type ReactNode } from "react";
import type { ActionState } from "@/lib/action-state";
import { Button } from "./ui";

/**
 * A form bound to a server action that shows its error or success message.
 * Submits through startTransition instead of the form `action` prop, because
 * React resets every field after a form action, which would wipe what staff
 * typed whenever validation fails.
 */
export function ActionForm({
  action,
  children,
  submitLabel = "Save",
  pendingLabel = "Saving…",
  className,
  submitVariant = "primary",
  confirm,
  resetOnSuccess,
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
  children?: ReactNode;
  submitLabel?: string;
  pendingLabel?: string;
  className?: string;
  submitVariant?: "primary" | "secondary" | "danger" | "ghost";
  confirm?: string;
  resetOnSuccess?: boolean;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (resetOnSuccess && state.ok) formRef.current?.reset();
  }, [state, resetOnSuccess]);

  return (
    <form
      ref={formRef}
      className={className ?? "space-y-4"}
      onSubmit={(e) => {
        e.preventDefault();
        if (confirm && !window.confirm(confirm)) return;
        const fd = new FormData(e.currentTarget, (e.nativeEvent as SubmitEvent).submitter);
        startTransition(() => formAction(fd));
      }}
    >
      {children}
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" variant={submitVariant} disabled={pending}>
          {pending ? pendingLabel : submitLabel}
        </Button>
        {state.error && <p role="alert" className="whitespace-pre-line text-sm text-red-600 dark:text-red-400">{state.error}</p>}
        {state.ok && <p role="status" className="text-sm text-emerald-700 dark:text-emerald-400">{state.ok}</p>}
      </div>
    </form>
  );
}
