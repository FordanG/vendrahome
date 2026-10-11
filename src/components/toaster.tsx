"use client";

import { useEffect, useState } from "react";

const EVENT = "vendra:saved";

/**
 * Shows a message for a few seconds at the top of the screen. Used when the form that
 * did the work disappears with its own message, e.g. a request leaving the "Needs a reply" list.
 */
export function showSaved(message: string) {
  window.dispatchEvent(new CustomEvent(EVENT, { detail: message }));
}

export function Toaster() {
  const [message, setMessage] = useState<{ text: string; at: number } | null>(null);
  useEffect(() => {
    const onSaved = (e: Event) => setMessage({ text: (e as CustomEvent<string>).detail, at: Date.now() });
    window.addEventListener(EVENT, onSaved);
    return () => window.removeEventListener(EVENT, onSaved);
  }, []);
  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(() => setMessage(null), 6000);
    return () => clearTimeout(timer);
  }, [message]);
  return (
    <div aria-live="polite" className="no-print pointer-events-none fixed inset-x-0 top-[calc(3.5rem+env(safe-area-inset-top))] z-50 flex justify-center px-4 md:top-4">
      {message && (
        <p
          key={message.at}
          role="status"
          className="pointer-events-auto max-w-md border-l-4 border-l-brand bg-sidebar px-4 py-3 text-sm text-sidebar-foreground shadow-lg"
          onClick={() => setMessage(null)}
        >
          {message.text}
        </p>
      )}
    </div>
  );
}
