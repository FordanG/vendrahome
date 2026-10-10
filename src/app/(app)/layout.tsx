import Link from "next/link";
import { redirect } from "next/navigation";
import { and, count, eq } from "drizzle-orm";
import { requestScope } from "@/lib/service-work";
import { getDb, schema } from "@/db";
import { requireStaff, ROLE_LABELS, signOut } from "@/lib/auth";
import type { StaffRole } from "@/db/schema";
import type { IconName } from "@/components/icons";
import { Brand } from "@/components/brand";
import { BottomNav, SidebarNav, type NavGroup, type NavLink } from "./nav-links";

type NavItem = { href: string; label: string; roles?: StaffRole[]; icon?: IconName };

const NAV: { label: string; items: NavItem[] }[] = [
  {
    label: "Today",
    items: [
      { href: "/", label: "Room board", icon: "board" },
      { href: "/requests", label: "Requests", icon: "requests" },
      { href: "/maintenance", label: "Maintenance", icon: "maintenance" },
      { href: "/housekeeping", label: "Housekeeping", roles: ["admin", "front_desk"] },
    ],
  },
  {
    label: "People",
    items: [
      { href: "/occupants", label: "Tenants", roles: ["admin", "front_desk"], icon: "tenants" },
      { href: "/assignments", label: "Room assignments", roles: ["admin", "front_desk"] },
    ],
  },
  {
    label: "Leasing",
    items: [
      { href: "/contracts", label: "Contracts", roles: ["admin", "front_desk"] },
      { href: "/clients", label: "Companies", roles: ["admin", "front_desk"] },
    ],
  },
  {
    label: "Money",
    items: [{ href: "/billing", label: "Billing", roles: ["admin", "front_desk"] }],
  },
  {
    label: "Property",
    items: [
      { href: "/rooms", label: "Rooms", icon: "rooms" },
      { href: "/inventory", label: "Room inventory" },
      { href: "/schedules", label: "Kitchen & laundry" },
      { href: "/house-rules", label: "House rules" },
      { href: "/staff", label: "Staff", roles: ["admin"] },
      { href: "/audit", label: "Audit history", roles: ["admin"] },
    ],
  },
];

// Phone tab bar: the first four of these a role can open; the rest go under "More".
const TAB_ORDER = ["/", "/requests", "/occupants", "/maintenance", "/rooms"];
const TAB_LABELS: Record<string, string> = { "/": "Board" };

async function logout() {
  "use server";
  await signOut();
  redirect("/login");
}

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const user = await requireStaff();
  const db = await getDb();
  const [{ waiting }] = await db
    .select({ waiting: count() })
    .from(schema.tenantRequests)
    .where(and(eq(schema.tenantRequests.status, "pending"), requestScope(user)));

  const groups: NavGroup[] = NAV.map((g) => ({
    label: g.label,
    items: g.items
      .filter((n) => !n.roles || n.roles.includes(user.role))
      .map(({ href, label, icon }) => ({ href, label, icon, count: href === "/requests" ? waiting : undefined })),
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
      <header className="no-print sticky top-0 z-30 border-b border-white/10 bg-sidebar pt-[env(safe-area-inset-top)] text-sidebar-foreground md:hidden">
        <div className="flex h-12 items-center justify-between gap-3 px-4">
          <Brand className="text-lg" />
          <p className="min-w-0 truncate text-xs text-sidebar-muted">{user.name}</p>
        </div>
      </header>
      <BottomNav
        tabs={tabs}
        more={more}
        moreFooter={
          <>
            <p className="px-3 pb-2 text-xs text-muted">{userLine}</p>
            <Link href="/account" className="flex min-h-12 items-center rounded-lg px-3 text-base hover:bg-background">
              My account
            </Link>
            <form action={logout}>
              <button className="flex min-h-12 w-full items-center rounded-lg px-3 text-left text-base text-attention hover:bg-background">
                Sign out
              </button>
            </form>
          </>
        }
      />

      <aside className="no-print hidden border-r border-white/10 bg-sidebar text-sidebar-foreground md:sticky md:top-0 md:block md:h-screen md:w-60 md:shrink-0 md:overflow-y-auto">
        <div className="px-6 pb-6 pt-6">
          <Brand className="text-xl" />
          <p className="mt-2 text-xs text-sidebar-muted">{userLine}</p>
          <div className="mt-3 flex gap-3 text-xs">
            <Link href="/account" className="text-sidebar-muted underline-offset-2 hover:text-sidebar-foreground hover:underline">
              My account
            </Link>
            <form action={logout}>
              <button className="text-sidebar-muted underline-offset-2 hover:text-sidebar-foreground hover:underline">Sign out</button>
            </form>
          </div>
        </div>
        <SidebarNav groups={groups} />
      </aside>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 pb-[calc(6rem+env(safe-area-inset-bottom))] pt-5 sm:px-8 sm:pt-8 md:pb-8">
        {children}
      </main>
    </div>
  );
}
