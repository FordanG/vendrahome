import { ActionForm } from "@/components/action-form";
import { Input } from "@/components/ui";
import { rateService } from "./actions";

/** Five tappable stars and an optional comment. */
export function RateForm({ subjectId, label }: { subjectId: string; label: string }) {
  return (
    <ActionForm action={rateService.bind(null, subjectId)} submitLabel="Send" pendingLabel="Sending…" className="space-y-2 py-3 first:pt-0 last:pb-0">
      <p className="text-sm font-medium">{label}</p>
      <fieldset className="flex gap-1" aria-label="Stars">
        {[1, 2, 3, 4, 5].map((n) => (
          <label key={n} className="flex size-11 cursor-pointer items-center justify-center border border-border text-lg has-checked:border-brand has-checked:bg-brand has-checked:text-brand-foreground">
            <input type="radio" name="stars" value={n} required className="sr-only" />
            <span aria-hidden>{n}★</span>
            <span className="sr-only">{n} {n === 1 ? "star" : "stars"}</span>
          </label>
        ))}
      </fieldset>
      <Input name="comment" placeholder="Anything to add? Optional" aria-label="Comment" maxLength={1000} />
    </ActionForm>
  );
}
