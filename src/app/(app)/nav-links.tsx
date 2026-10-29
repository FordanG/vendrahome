"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { Icon, type IconName } from "@/components/icons";

export type NavLink = { href: string; label: string; count?: number; icon?: IconName };
export type NavGroup = { label: string; items: NavLink[] };

/** With `exact`, a portal's home tab ("/me", "/company") matches only itself; deeper tabs still match their sub-pages. */
export function isActive(pathname: string, href: string, exact?: boolean) {
  if (href === "/") return pathname === href;
  if (exact) return pathname === href || (href.split("/").length > 2 && pathname.startsWith(`${href}/`));
  return pathname.startsWith(href);
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
    <nav className="flex flex-col gap-5 px-3 pb-6 pt-1">
      {groups.map((g) => (
        <div key={g.label} className="flex flex-col gap-px">
          <p className="px-3 pb-1.5 text-[11px] font-medium text-sidebar-muted/80">{g.label}</p>
          {g.items.map((item) => {
            const active = isActive(pathname, item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={`group relative flex items-center gap-3 whitespace-nowrap rounded-lg px-3 py-[7px] text-sm transition-colors ${
                  active
                    ? "bg-white/[0.09] font-medium text-sidebar-foreground"
                    : "text-sidebar-foreground/70 hover:bg-white/[0.05] hover:text-sidebar-foreground"
                }`}
              >
                <Icon
                  name={item.icon ?? "more"}
                  className={`size-[18px] shrink-0 transition-colors ${active ? "text-brand" : "text-sidebar-muted group-hover:text-sidebar-foreground"}`}
                />
                <span className="flex-1">{item.label}</span>
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
      className={`relative flex min-h-14 flex-1 flex-col items-center justify-center gap-1 px-1 text-[11px] leading-tight transition-colors ${
        active ? "font-semibold text-sidebar-foreground" : "text-sidebar-foreground/60"
      }`}
    >
      <span className={`relative flex h-7 w-12 items-center justify-center rounded-full transition-colors ${active ? "bg-white/[0.12] text-brand" : ""}`}>
        <Icon name={item.icon ?? "more"} className="size-[22px]" />
        {!!item.count && <CountBubble count={item.count} className="absolute -right-0.5 -top-1 px-1 text-[10px] leading-4 ring-2 ring-sidebar" />}
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
          <div className="absolute inset-0 bg-black/45 backdrop-blur-[2px]" aria-hidden onClick={() => setOpenAt(null)} />
          <div className="absolute inset-x-0 bottom-0 max-h-[80dvh] overflow-y-auto rounded-t-2xl bg-surface pb-[calc(4.5rem+env(safe-area-inset-bottom))] shadow-pop">
            <div className="sticky top-0 flex items-center justify-between border-b border-border bg-surface/95 px-5 py-3 backdrop-blur">
              <p className="font-semibold">More</p>
              <button
                type="button"
                onClick={() => setOpenAt(null)}
                className="-mr-2 flex size-11 items-center justify-center rounded-full text-muted hover:bg-subtle"
                aria-label="Close"
              >
                <Icon name="close" className="size-5" />
              </button>
            </div>
            <nav className="space-y-5 px-3 py-4">
              {more.map((g) => (
                <div key={g.label}>
                  <p className="px-3 pb-1 text-xs font-medium text-muted">{g.label}</p>
                  {g.items.map((item) => {
                    const active = isActive(pathname, item.href, exact);
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        aria-current={active ? "page" : undefined}
                        className={`flex min-h-12 items-center gap-3 rounded-lg px-3 text-base ${
                          active ? "bg-foreground/[0.06] font-medium" : "hover:bg-subtle"
                        }`}
                      >
                        <Icon name={item.icon ?? "more"} className={`size-5 shrink-0 ${active ? "text-brand-ink" : "text-muted"}`} />
                        <span className="flex-1">{item.label}</span>
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
        className="fixed inset-x-0 bottom-0 z-50 flex border-t border-white/[0.06] bg-sidebar/95 px-1 pb-[env(safe-area-inset-bottom)] pt-1 text-sidebar-foreground backdrop-blur"
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
            className={`relative flex min-h-14 flex-1 flex-col items-center justify-center gap-1 px-1 text-[11px] leading-tight ${
              open || moreActive ? "font-semibold text-sidebar-foreground" : "text-sidebar-foreground/60"
            }`}
          >
            <span className={`flex h-7 w-12 items-center justify-center rounded-full transition-colors ${open || moreActive ? "bg-white/[0.12] text-brand" : ""}`}>
              <Icon name="more" className="size-[22px]" />
            </span>
            More
          </button>
        )}
      </nav>
    </div>
  );
}
