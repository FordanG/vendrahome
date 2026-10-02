import { BRAND } from "@/lib/brand";

/** Vendrato's mark: three squares stepping up, with a fainter fourth under the top one. */
export function BrandMark({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 34 34" className={`shrink-0 fill-brand ${className}`} aria-hidden>
      <rect x="0" y="24" width="10" height="10" />
      <rect x="12" y="12" width="10" height="10" />
      <rect x="24" y="0" width="10" height="10" />
      <rect x="24" y="12" width="10" height="10" opacity=".35" />
    </svg>
  );
}

/** The logo: mark and name. Sized by the text size it is given (e.g. `text-xl`). */
export function Brand({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-[0.5em] ${className}`}>
      <BrandMark className="size-[1.05em]" />
      <span className="font-heading font-bold leading-none tracking-[-0.045em]">{BRAND.wordmark}</span>
    </span>
  );
}
