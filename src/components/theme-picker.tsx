import { setTheme } from "@/app/theme-actions";
import { getTheme, THEME_LABELS, THEMES } from "@/lib/theme";
import { Card, SectionTitle } from "./ui";

/** Light, dark or follow the device. Applies as soon as one is picked. */
export async function ThemePicker() {
  const current = await getTheme();
  return (
    <Card className="max-w-md">
      <SectionTitle>Light or dark</SectionTitle>
      <form action={setTheme} className="flex border border-border bg-background p-0.5 text-sm" role="group" aria-label="Light or dark">
        {THEMES.map((t) => (
          <button
            key={t}
            name="theme"
            value={t}
            aria-pressed={current === t}
            className={`flex min-h-11 flex-1 items-center justify-center whitespace-nowrap px-3 py-1.5 transition-colors sm:min-h-9 ${
              current === t ? "bg-accent font-medium text-accent-foreground" : "text-muted hover:text-foreground"
            }`}
          >
            {THEME_LABELS[t]}
          </button>
        ))}
      </form>
      <p className="mt-2 text-xs text-muted">
        Remembered on this phone or computer only. &quot;Same as device&quot; follows the device&apos;s own light or dark setting.
      </p>
    </Card>
  );
}
