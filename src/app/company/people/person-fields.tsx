import type { Occupant } from "@/db/schema";
import { OCCUPANT_FIELDS, OCCUPANT_GROUPS } from "@/lib/occupants";
import { Detail, Field, Input, Select, Textarea } from "@/components/ui";

// Hotel notes stay with the hotel; companies see and edit everything else about their people.
const FIELDS = OCCUPANT_FIELDS.filter((f) => f.key !== "notes");

/** A person's details as a form, or read-only when the company's agreement says the hotel keeps them. */
export function PersonFields({ occupant, readOnly }: { occupant?: Occupant; readOnly?: boolean }) {
  return (
    <div className="space-y-6">
      {OCCUPANT_GROUPS.map((group) => {
        const fields = FIELDS.filter((f) => f.group === group);
        if (fields.length === 0) return null;
        return (
          <fieldset key={group}>
            <legend className="mb-3 text-sm font-semibold">{group}</legend>
            {readOnly ? (
              <dl className="grid gap-3 sm:grid-cols-2">
                {fields.map((f) => (
                  <Detail key={f.key} label={f.label}>
                    {occupant?.[f.key]}
                  </Detail>
                ))}
              </dl>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2">
                {fields.map((f) => {
                  const value = occupant?.[f.key] ?? "";
                  const wide = "wide" in f && f.wide;
                  return (
                    <Field key={f.key} label={f.label} hint={"hint" in f ? f.hint : undefined} className={wide ? "sm:col-span-2" : undefined}>
                      {"options" in f ? (
                        <Select name={f.key} defaultValue={value}>
                          <option value="">Not set</option>
                          {f.options.map((o) => (
                            <option key={o} value={o}>
                              {o}
                            </option>
                          ))}
                        </Select>
                      ) : "textarea" in f ? (
                        <Textarea name={f.key} defaultValue={value} />
                      ) : (
                        <Input name={f.key} type={"type" in f ? f.type : "text"} defaultValue={value} required={"required" in f && f.required} />
                      )}
                    </Field>
                  );
                })}
              </div>
            )}
          </fieldset>
        );
      })}
    </div>
  );
}
