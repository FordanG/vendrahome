"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { isActive, type NavLink } from "../(app)/nav-links";

/** Tenant and company tabs under the header on wide screens. Phones use the bottom tab bar. */
export function TopTabs({ items }: { items: NavLink[] }) {
  const pathname = usePathname();
  return (
    <nav className="hidden items-center gap-1 md:flex">
      {items.map((item) => {
        const active = isActive(pathname, item.href, true);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={`flex items-center whitespace-nowrap rounded-full px-3.5 py-1.5 text-sm transition-colors ${
              active
                ? "bg-white/[0.12] font-medium text-sidebar-foreground"
                : "text-sidebar-foreground/65 hover:bg-white/[0.06] hover:text-sidebar-foreground"
            }`}
          >
            {item.label}
            {!!item.count && <span className="ml-1.5 rounded-full bg-brand px-1.5 text-xs font-semibold text-brand-foreground">{item.count}</span>}
          </Link>
        );
      })}
    </nav>
  );
}
