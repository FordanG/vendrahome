import { BRAND } from "@/lib/brand";

/** Vendrato's mark (from vendrato.com): a V with an orange triangle. The V takes the text colour, so it works on light and dark. */
export function BrandMark({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 256 218" className={`shrink-0 ${className}`} aria-hidden>
      <path fill="currentColor" d="M0 0h91l51.7 88-15.1 26-51.9-88.5h-30l83.2 141.5L227 0h29L128 218z" />
      <path fill={BRAND.logoOrange} d="M117 0h77l-38.5 65.6z" />
    </svg>
  );
}

/** The logo: mark and name. Sized by the text size it is given (e.g. `text-xl`). */
export function Brand({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-[0.5em] ${className}`}>
      <BrandMark className="h-[1.05em] w-auto" />
      <span className="font-heading font-bold leading-none tracking-[-0.045em]">{BRAND.wordmark}</span>
    </span>
  );
}
