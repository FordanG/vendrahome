"use client";

import { startTransition, useActionState, useEffect, useRef, type ReactNode } from "react";
import type { ActionState } from "@/lib/action-state";
import { Button } from "./ui";
import { showSaved } from "./toaster";

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
  // Saving often takes the form off the page (a request leaves its list, a move-in is done),
  // and the new page arrives together with the result, so the form never shows its message.
  // When that happens, the message shows at the top of the screen instead.
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const [state, formAction, pending] = useActionState(async (previous: ActionState, fd: FormData) => {
    const result = await action(previous, fd);
    if (result.ok) {
      const text = result.ok;
      let shown = false;
      for (const wait of [400, 1500])
        setTimeout(() => {
          if (!shown && !mounted.current) {
            shown = true;
            showSaved(text);
          }
        }, wait);
    }
    return result;
  }, {});
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
