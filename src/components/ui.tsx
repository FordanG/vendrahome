import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

export function PageHeader({
  title,
  subtitle,
  actions,
  back,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  back?: { href: string; label: string };
}) {
  return (
    <div className="mb-6">
      {back && (
        <Link
          href={back.href}
          className="no-print -ml-1 inline-flex min-h-11 items-center gap-1 rounded-md px-1 text-sm text-muted transition-colors hover:text-foreground sm:min-h-0 sm:py-0.5"
        >
          <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
            <path d="m15 6-6 6 6 6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          {back.label}
        </Link>
      )}
      <div className="mt-1 flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="plate text-[1.75rem] font-bold leading-tight tracking-tight sm:text-[2rem]">{title}</h1>
          {subtitle && <p className="mt-1.5 max-w-3xl text-sm leading-relaxed text-muted">{subtitle}</p>}
        </div>
        {/* Phones: actions share a full-width row, each as wide as its words, so they are easy to reach. */}
        {actions && (
          <div className="no-print flex w-full flex-wrap gap-2 *:grow *:whitespace-nowrap sm:w-auto sm:*:grow-0">{actions}</div>
        )}
      </div>
    </div>
  );
}

export function Card({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cx("rounded-xl border border-border bg-surface p-4 shadow-card sm:p-5", className)}
      {...props}
    />
  );
}

export function SectionTitle({ children, actions }: { children: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-2">
      <h2 className="text-base font-semibold tracking-tight">{children}</h2>
      {actions}
    </div>
  );
}

// Phones get 44px-tall tap targets; wider screens keep the compact size.
const buttonBase =
  "inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium active:scale-[0.98] sm:min-h-9 sm:px-3.5 transition disabled:opacity-50 disabled:pointer-events-none";
const variants = {
  primary: "bg-accent text-accent-foreground shadow-card hover:bg-brand hover:text-brand-foreground",
  secondary: "border border-border bg-surface shadow-card hover:border-field-border hover:bg-subtle",
  danger: "border border-attention/30 bg-surface text-attention shadow-card hover:bg-attention/10",
  ghost: "text-muted hover:text-foreground hover:bg-foreground/5",
};
type Variant = keyof typeof variants;

export function Button({
  variant = "primary",
  className,
  ...props
}: ComponentProps<"button"> & { variant?: Variant }) {
  return <button className={cx(buttonBase, variants[variant], className)} {...props} />;
}

export function LinkButton({
  variant = "primary",
  className,
  ...props
}: ComponentProps<typeof Link> & { variant?: Variant }) {
  return <Link className={cx(buttonBase, variants[variant], className)} {...props} />;
}

// 16px text on phones: smaller text makes iPhones zoom in when a field is tapped.
const inputBase =
  "min-h-11 rounded-lg border border-field-border bg-field px-3 py-2 text-base shadow-[inset_0_1px_2px_rgb(0_0_0/0.04)] outline-none placeholder:text-muted/70 sm:min-h-9 sm:text-sm transition focus:border-brand focus:ring-4 focus:ring-brand/15";
// Full width unless the caller sets its own width (e.g. "w-40").
const inputClass = (className?: string) => cx(inputBase, !/(^|\s)w-/.test(className ?? "") && "w-full", className);

export function Input({ className, ...props }: ComponentProps<"input">) {
  return <input className={inputClass(className)} {...props} />;
}

export function Textarea({ className, ...props }: ComponentProps<"textarea">) {
  return <textarea rows={3} className={inputClass(className)} {...props} />;
}

export function Select({ className, ...props }: ComponentProps<"select">) {
  return <select className={inputClass(className)} {...props} />;
}

export function Field({
  label,
  hint,
  children,
  className,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={cx("block", className)}>
      <span className="mb-1.5 block text-sm font-medium">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-muted">{hint}</span>}
    </label>
  );
}

export function FormGrid({ children }: { children: ReactNode }) {
  return <div className="grid gap-4 sm:grid-cols-2">{children}</div>;
}

const tones = {
  gray: "bg-stone-100 text-stone-700 ring-stone-500/15 dark:bg-white/8 dark:text-stone-300 dark:ring-white/10",
  green: "bg-emerald-50 text-emerald-700 ring-emerald-600/20 dark:bg-emerald-400/10 dark:text-emerald-300 dark:ring-emerald-400/20",
  blue: "bg-sky-50 text-sky-700 ring-sky-600/20 dark:bg-sky-400/10 dark:text-sky-300 dark:ring-sky-400/20",
  amber: "bg-amber-50 text-amber-800 ring-amber-600/25 dark:bg-amber-400/10 dark:text-amber-300 dark:ring-amber-400/20",
  red: "bg-attention/8 text-attention ring-attention/25",
};
export type Tone = keyof typeof tones;

export function Badge({ tone = "gray", children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span className={cx("inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset", tones[tone])}>
      {children}
    </span>
  );
}

/**
 * On phones each row becomes a card: the `primary` cell is the title and the others
 * show their `label` above the value, two per line (see `.rtable` in globals.css).
 */
export function Table({ children }: { children: ReactNode }) {
  return (
    <div className="rtable overflow-hidden rounded-xl border border-border bg-surface shadow-card sm:overflow-x-auto">
      <table className="w-full text-left text-sm sm:[&_tbody_tr:hover]:bg-subtle sm:[&_tbody_tr:last-child>td]:border-b-0">{children}</table>
    </div>
  );
}

export function Th({ children, className }: { children?: ReactNode; className?: string }) {
  return (
    <th className={cx("border-b border-border bg-subtle px-4 py-2.5 text-xs font-medium text-muted", className)}>
      {children}
    </th>
  );
}

export function Td({
  children,
  className,
  label,
  primary,
  wide,
}: {
  children?: ReactNode;
  className?: string;
  /** Shown before the value on phones, where the column headings are hidden. */
  label?: string;
  /** The row's title on phones. */
  primary?: boolean;
  /** Takes the card's full width on phones, for long values. */
  wide?: boolean;
}) {
  return (
    <td
      data-label={label}
      data-primary={primary || undefined}
      data-wide={wide || undefined}
      className={cx("border-b border-border px-4 py-3 align-top transition-colors", className)}
    >
      {children}
    </td>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="rounded-xl border border-dashed border-field-border/60 bg-surface/50 px-6 py-10 text-center text-sm text-muted">{children}</p>;
}

/** A labelled value. Blank values read "Not set" (or `empty`) instead of a bare dash. */
export function Detail({ label, children, empty = "Not set" }: { label: string; children: ReactNode; empty?: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="mt-0.5 text-sm [overflow-wrap:anywhere]">{children || <span className="text-muted">{empty}</span>}</dd>
    </div>
  );
}

/** A row of view links, e.g. Open / Waiting / Closed. */
export function ViewTabs({ items }: { items: { href: string; label: string; count?: number; active: boolean }[] }) {
  return (
    <nav className="no-print flex max-w-full overflow-x-auto rounded-xl bg-foreground/[0.06] p-1 text-sm sm:inline-flex">
      {items.map((i) => (
        <Link
          key={i.href}
          href={i.href}
          aria-current={i.active ? "page" : undefined}
          className={cx(
            "flex min-h-10 flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-1.5 transition sm:min-h-0 sm:flex-none",
            i.active ? "bg-surface font-medium text-foreground shadow-card" : "text-muted hover:text-foreground",
          )}
        >
          {i.label}
          {i.count != null && (
            <span className={cx("plate rounded-full px-1.5 text-xs font-bold leading-5", i.active ? "bg-foreground/[0.08]" : "text-foreground")}>{i.count}</span>
          )}
        </Link>
      ))}
    </nav>
  );
}
