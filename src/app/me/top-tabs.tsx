"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { isActive, type NavLink } from "../(app)/nav-links";

/** Tenant and company tabs under the header on wide screens. Phones use the bottom tab bar. */
export function TopTabs({ items }: { items: NavLink[] }) {
  const pathname = usePathname();
  return (
    <nav className="hidden gap-1 px-4 md:flex">
      {items.map((item) => {
        const active = isActive(pathname, item.href, true);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={`whitespace-nowrap border-b-2 px-3 pb-2.5 pt-1 text-sm transition-colors ${
              active
                ? "border-brand font-medium text-sidebar-foreground"
                : "border-transparent text-sidebar-foreground/70 hover:text-sidebar-foreground"
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
