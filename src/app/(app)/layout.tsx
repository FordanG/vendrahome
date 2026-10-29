import Link from "next/link";
import { redirect } from "next/navigation";
import { and, count, eq } from "drizzle-orm";
import { requestScope } from "@/lib/service-work";
import { getDb, schema } from "@/db";
import { CAN, ROLE_LABELS, signOut } from "@/lib/auth";
import { inHotelRooms, isOwner, requireHotel } from "@/lib/hotel";
import { HotelSwitcher } from "./hotel-switcher";
import type { StaffRole } from "@/db/schema";
import type { IconName } from "@/components/icons";
import { Brand } from "@/components/brand";
import { Icon } from "@/components/icons";
import { BottomNav, SidebarNav, type NavGroup, type NavLink } from "./nav-links";

type NavItem = { href: string; label: string; roles?: StaffRole[]; icon?: IconName; ownerOnly?: boolean };

const NAV: { label: string; items: NavItem[] }[] = [
  {
    label: "Today",
    items: [
      { href: "/", label: "Room board", icon: "board" },
      { href: "/requests", label: "Requests", icon: "requests" },
      { href: "/maintenance", label: "Maintenance", icon: "maintenance" },
      { href: "/housekeeping", label: "Housekeeping", roles: ["admin", "front_desk"], icon: "housekeeping" },
      { href: "/laundry", label: "Laundry", roles: ["admin", "front_desk"], icon: "laundry" },
    ],
  },
  {
    label: "People",
    items: [
      { href: "/occupants", label: "Tenants", roles: ["admin", "front_desk"], icon: "tenants" },
      { href: "/assignments", label: "Room assignments", roles: ["admin", "front_desk"], icon: "key" },
      { href: "/feedback", label: "Feedback", roles: ["admin", "front_desk"], icon: "feedback" },
    ],
  },
  {
    label: "Leasing",
    items: [
      { href: "/availability", label: "Availability", roles: ["admin", "front_desk"], icon: "calendar" },
      { href: "/contracts", label: "Contracts", roles: ["admin", "front_desk"], icon: "contract" },
      { href: "/clients", label: "Companies", roles: ["admin", "front_desk"], icon: "company" },
    ],
  },
  {
    label: "Money",
    items: [{ href: "/billing", label: "Billing", roles: ["admin", "front_desk"], icon: "billing" }],
  },
  {
    label: "Property",
    items: [
      { href: "/rooms", label: "Rooms", icon: "rooms" },
      { href: "/inventory", label: "Room inventory", icon: "inventory" },
      { href: "/schedules", label: "Kitchen & laundry", icon: "clock" },
      { href: "/house-rules", label: "House rules", icon: "rules" },
      { href: "/hotels", label: "Hotels", roles: ["admin"], ownerOnly: true, icon: "hotels" },
      { href: "/staff", label: "Staff", roles: ["admin"], icon: "staff" },
      { href: "/audit", label: "Audit history", roles: ["admin"], ownerOnly: true, icon: "history" },
    ],
  },
];

// Phone tab bar: the first four of these a role can open; the rest go under "More".
const TAB_ORDER = ["/", "/requests", "/occupants", "/maintenance", "/rooms"];
const TAB_LABELS: Record<string, string> = { "/": "Board" };

/** "Carmela Reyes (demo)" -> "CR". */
const initials = (name: string) =>
  name.replace(/\(.*?\)/g, "").trim().split(/\s+/).filter(Boolean).map((w) => w[0]).slice(0, 2).join("").toUpperCase() || "?";

async function logout() {
  "use server";
  await signOut();
  redirect("/login");
}

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const { user, hotel, hotels } = await requireHotel();
  const db = await getDb();
  const [[{ waiting }], [{ asks }]] = await Promise.all([
    db.select({ waiting: count() }).from(schema.tenantRequests).where(and(eq(schema.tenantRequests.status, "pending"), requestScope(user, hotel.id))),
    CAN.manageOccupants.includes(user.role)
      ? db.select({ asks: count() }).from(schema.stayRequests).where(and(eq(schema.stayRequests.status, "pending"), inHotelRooms(schema.stayRequests.roomId, hotel.id)))
      : Promise.resolve([{ asks: 0 }]),
  ]);

  const groups: NavGroup[] = NAV.map((g) => ({
    label: g.label,
    items: g.items
      .filter((n) => (!n.roles || n.roles.includes(user.role)) && (!n.ownerOnly || isOwner(user)))
      .map(({ href, label, icon }) => ({ href, label, icon, count: href === "/requests" ? waiting : href === "/assignments" ? asks : undefined })),
  })).filter((g) => g.items.length > 0);

  const allowed = groups.flatMap((g) => g.items);
  const tabs: NavLink[] = TAB_ORDER.flatMap((href) => allowed.filter((i) => i.href === href))
    .slice(0, 4)
    .map((i) => ({ ...i, label: TAB_LABELS[i.href] ?? i.label }));
  const more = groups
    .map((g) => ({ ...g, items: g.items.filter((i) => !tabs.some((t) => t.href === i.href)) }))
    .filter((g) => g.items.length > 0);
  const userLine = `${user.name}, ${ROLE_LABELS[user.role]}`;

  return (
    <div className="flex min-h-full flex-1 flex-col md:flex-row">
      {/* Phones: slim header on top, tab bar at the bottom. */}
      <header className="no-print sticky top-0 z-30 border-b border-white/[0.06] bg-sidebar/95 backdrop-blur pt-[env(safe-area-inset-top)] text-sidebar-foreground md:hidden">
        <div className="flex h-12 items-center justify-between gap-3 px-4">
          <Brand className="text-lg" />
          <p className="min-w-0 truncate text-xs text-sidebar-muted">{hotels.length > 1 ? hotel.name : user.name}</p>
        </div>
      </header>
      <BottomNav
        tabs={tabs}
        more={more}
        moreFooter={
          <>
            <p className="px-3 pb-2 text-xs text-muted">{userLine}</p>
            {hotels.length > 1 && <HotelSwitcher hotels={hotels} current={hotel.id} className="mb-2 px-3" />}
            <Link href="/account" className="flex min-h-12 items-center gap-3 rounded-lg px-3 text-base hover:bg-subtle">
              <Icon name="account" className="size-5 text-muted" />
              My account
            </Link>
            <form action={logout}>
              <button className="flex min-h-12 w-full items-center gap-3 rounded-lg px-3 text-left text-base text-attention hover:bg-subtle">
                <Icon name="signout" className="size-5" />
                Sign out
              </button>
            </form>
          </>
        }
      />

      <aside className="no-print hidden border-r border-white/[0.06] bg-sidebar text-sidebar-foreground md:sticky md:top-0 md:flex md:h-screen md:w-64 md:shrink-0 md:flex-col">
        <div className="px-5 pb-4 pt-6">
          <Brand className="text-xl" />
          {hotels.length > 1 ? (
            <HotelSwitcher hotels={hotels} current={hotel.id} className="mt-4" dark />
          ) : (
            <p className="mt-1.5 text-xs text-sidebar-muted">{hotel.name}</p>
          )}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <SidebarNav groups={groups} />
        </div>
        <div className="flex items-center gap-1 border-t border-white/[0.06] p-3">
          <Link
            href="/account"
            className="flex min-w-0 flex-1 items-center gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-white/[0.06]"
            title="My account"
          >
            <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-brand text-xs font-bold text-brand-foreground" aria-hidden>
              {initials(user.name)}
            </span>
            <span className="min-w-0">
              <span className="sr-only">My account: </span>
              <span className="block truncate text-sm font-medium">{user.name}</span>
              <span className="block truncate text-xs text-sidebar-muted">{ROLE_LABELS[user.role]}</span>
            </span>
          </Link>
          <form action={logout}>
            <button
              className="flex size-9 items-center justify-center rounded-lg text-sidebar-muted transition-colors hover:bg-white/[0.06] hover:text-sidebar-foreground"
              title="Sign out"
            >
              <Icon name="signout" className="size-5" />
              <span className="sr-only">Sign out</span>
            </button>
          </form>
        </div>
      </aside>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 pb-[calc(6rem+env(safe-area-inset-bottom))] pt-5 sm:px-8 sm:pt-8 md:pb-8">
        {children}
      </main>
    </div>
  );
}
