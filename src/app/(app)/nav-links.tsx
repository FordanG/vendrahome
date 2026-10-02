"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { Icon, type IconName } from "@/components/icons";

export type NavLink = { href: string; label: string; count?: number; icon?: IconName };
export type NavGroup = { label: string; items: NavLink[] };

function isActive(pathname: string, href: string, exact?: boolean) {
  return href === "/" || exact ? pathname === href : pathname.startsWith(href);
}

function CountBubble({ count, className = "" }: { count: number; className?: string }) {
  return (
    <span
      className={`rounded-full bg-brand px-1.5 text-xs font-semibold leading-5 text-brand-foreground ${className}`}
      title={`${count} waiting for a reply`}
    >
      {count}
      <span className="sr-only"> waiting for a reply</span>
    </span>
  );
}

/** Staff sidebar on wide screens: grouped and vertical. Phones use BottomNav instead. */
export function SidebarNav({ groups }: { groups: NavGroup[] }) {
  const pathname = usePathname();
  return (
    <nav className="flex flex-col gap-5 px-3 pb-6">
      {groups.map((g) => (
        <div key={g.label} className="flex flex-col gap-0.5">
          <p className="px-3 pb-1 text-xs text-sidebar-muted">{g.label}</p>
          {g.items.map((item) => {
            const active = isActive(pathname, item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={`relative flex items-center justify-between gap-3 whitespace-nowrap rounded-md px-3 py-1.5 text-sm transition-colors ${
                  active
                    ? "bg-white/10 font-medium text-sidebar-foreground before:absolute before:inset-y-1.5 before:-left-3 before:w-1 before:rounded-r before:bg-brand"
                    : "text-sidebar-foreground/75 hover:bg-white/5 hover:text-sidebar-foreground"
                }`}
              >
                {item.label}
                {!!item.count && <CountBubble count={item.count} />}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}

function Tab({ item, active }: { item: NavLink; active: boolean }) {
  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      className={`relative flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 px-1 text-[11px] leading-tight transition-colors ${
        active ? "font-semibold text-sidebar-foreground" : "text-sidebar-foreground/65"
      }`}
    >
      {active && <span className="absolute inset-x-3 top-0 h-[3px] bg-brand" aria-hidden />}
      <span className="relative">
        <Icon name={item.icon ?? "more"} />
        {!!item.count && <CountBubble count={item.count} className="absolute -right-3 -top-1.5 px-1 text-[10px] leading-4" />}
      </span>
      <span className="max-w-full truncate">{item.label}</span>
    </Link>
  );
}

/**
 * Phone tab bar fixed to the bottom of the screen, within thumb reach.
 * The first few pages get a tab; everything else is under "More", which opens a sheet.
 */
export function BottomNav({
  tabs,
  more,
  moreFooter,
  exact,
}: {
  tabs: NavLink[];
  more?: NavGroup[];
  moreFooter?: ReactNode;
  exact?: boolean;
}) {
  const pathname = usePathname();
  // Remember where the sheet was opened, so going to another page closes it.
  const [openAt, setOpenAt] = useState<string | null>(null);
  const open = openAt === pathname;
  const moreActive = !!more?.some((g) => g.items.some((i) => isActive(pathname, i.href, exact)));

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpenAt(null);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <div className="no-print md:hidden">
      {open && more && (
        <div className="fixed inset-0 z-40" role="dialog" aria-modal="true" aria-label="More pages">
          {/* Tapping outside closes it; the X button and Escape do the same for keyboards and screen readers. */}
          <div className="absolute inset-0 bg-black/40" aria-hidden onClick={() => setOpenAt(null)} />
          <div className="absolute inset-x-0 bottom-0 max-h-[80dvh] overflow-y-auto rounded-t-2xl bg-surface pb-[calc(4.5rem+env(safe-area-inset-bottom))] shadow-2xl">
            <div className="sticky top-0 flex items-center justify-between border-b border-border bg-surface px-5 py-3">
              <p className="font-semibold">More</p>
              <button
                type="button"
                onClick={() => setOpenAt(null)}
                className="-mr-2 flex size-11 items-center justify-center rounded-full text-muted hover:bg-background"
                aria-label="Close"
              >
                <Icon name="close" className="size-5" />
              </button>
            </div>
            <nav className="space-y-5 px-3 py-4">
              {more.map((g) => (
                <div key={g.label}>
                  <p className="px-3 pb-1 text-xs text-muted">{g.label}</p>
                  {g.items.map((item) => {
                    const active = isActive(pathname, item.href, exact);
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        aria-current={active ? "page" : undefined}
                        className={`flex min-h-12 items-center justify-between rounded-lg px-3 text-base ${
                          active ? "bg-accent/10 font-medium text-accent" : "hover:bg-background"
                        }`}
                      >
                        {item.label}
                        {!!item.count && <CountBubble count={item.count} />}
                      </Link>
                    );
                  })}
                </div>
              ))}
            </nav>
            {moreFooter && <div className="border-t border-border px-3 py-3">{moreFooter}</div>}
          </div>
        </div>
      )}
      <nav
        className="fixed inset-x-0 bottom-0 z-50 flex border-t border-white/10 bg-sidebar pb-[env(safe-area-inset-bottom)] text-sidebar-foreground"
        aria-label="Main"
      >
        {tabs.map((item) => (
          <Tab key={item.href} item={item} active={!open && isActive(pathname, item.href, exact)} />
        ))}
        {more && (
          <button
            type="button"
            onClick={() => setOpenAt(open ? null : pathname)}
            aria-expanded={open}
            className={`relative flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 px-1 text-[11px] leading-tight ${
              open || moreActive ? "font-semibold text-sidebar-foreground" : "text-sidebar-foreground/65"
            }`}
          >
            {(open || moreActive) && <span className="absolute inset-x-3 top-0 h-[3px] bg-brand" aria-hidden />}
            <Icon name="more" />
            More
          </button>
        )}
      </nav>
    </div>
  );
}
