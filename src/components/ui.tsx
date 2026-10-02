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
          className="no-print -ml-1 inline-flex min-h-11 items-center px-1 text-sm text-muted hover:text-foreground sm:min-h-0"
        >
          ← {back.label}
        </Link>
      )}
      <div className="mt-1 flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="plate text-[1.75rem] font-bold leading-tight sm:text-3xl">{title}</h1>
          {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
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
      className={cx("rounded-xl border border-border bg-surface p-4 sm:p-5", className)}
      {...props}
    />
  );
}

export function SectionTitle({ children, actions }: { children: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-2">
      <h2 className="text-[15px] font-semibold">{children}</h2>
      {actions}
    </div>
  );
}

// Phones get 44px-tall tap targets; wider screens keep the compact size.
const buttonBase =
  "inline-flex min-h-11 items-center justify-center gap-1.5 rounded-md px-4 py-2 text-sm font-medium active:opacity-80 sm:min-h-0 sm:px-3.5 transition-colors disabled:opacity-50 disabled:pointer-events-none";
const variants = {
  primary: "bg-accent text-accent-foreground hover:bg-brand hover:text-brand-foreground",
  secondary: "border border-border bg-surface hover:border-accent/40 hover:bg-background",
  danger: "border border-attention/40 bg-surface text-attention hover:bg-attention/10",
  ghost: "text-muted hover:text-foreground hover:bg-background",
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
  "min-h-11 rounded-md border border-field-border bg-field px-3 py-2 text-base outline-none sm:min-h-0 sm:text-sm transition-colors focus:border-brand focus:ring-2 focus:ring-brand/25";
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
      <span className="mb-1 block text-sm font-medium">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-muted">{hint}</span>}
    </label>
  );
}

export function FormGrid({ children }: { children: ReactNode }) {
  return <div className="grid gap-4 sm:grid-cols-2">{children}</div>;
}

const tones = {
  gray: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
  green: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  blue: "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300",
  amber: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  red: "bg-attention/12 text-attention",
};
export type Tone = keyof typeof tones;

export function Badge({ tone = "gray", children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span className={cx("inline-flex items-center px-2 py-0.5 text-xs font-medium", tones[tone])}>
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
    <div className="rtable overflow-hidden rounded-xl border border-border bg-surface sm:overflow-x-auto">
      <table className="w-full text-left text-sm">{children}</table>
    </div>
  );
}

export function Th({ children, className }: { children?: ReactNode; className?: string }) {
  return (
    <th className={cx("border-b border-border bg-background/60 px-3 py-2 text-xs font-medium text-muted", className)}>
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
      className={cx("border-b border-border px-3 py-2 align-top", className)}
    >
      {children}
    </td>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted">{children}</p>;
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
    <nav className="no-print flex max-w-full overflow-x-auto rounded-lg border border-border bg-surface p-0.5 text-sm sm:inline-flex">
      {items.map((i) => (
        <Link
          key={i.href}
          href={i.href}
          aria-current={i.active ? "page" : undefined}
          className={cx(
            "flex min-h-10 flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-md px-3 py-1.5 transition-colors sm:min-h-0 sm:flex-none",
            i.active ? "bg-accent font-medium text-accent-foreground" : "text-muted hover:text-foreground",
          )}
        >
          {i.label}
          {i.count != null && <span className={cx("plate font-bold", !i.active && "text-foreground")}>{i.count}</span>}
        </Link>
      ))}
    </nav>
  );
}
