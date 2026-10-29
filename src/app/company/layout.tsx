import { and, count, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { COMPANY_CAN, requireCompany, ROLE_LABELS } from "@/lib/auth";
import { companyRequestScope } from "@/lib/company";
import { BottomNav, type NavLink } from "../(app)/nav-links";
import { TopTabs } from "../me/top-tabs";
import { logout } from "./actions";
import { Brand } from "@/components/brand";
import { Icon } from "@/components/icons";

export default async function CompanyLayout({ children }: LayoutProps<"/company">) {
  const { user, client } = await requireCompany();
  const db = await getDb();
  const [{ waiting }] = await db
    .select({ waiting: count() })
    .from(schema.tenantRequests)
    .where(and(eq(schema.tenantRequests.awaitingCompany, true), await companyRequestScope(client.id)));
  const seesBills = client.showBilling && COMPANY_CAN.viewBilling.includes(user.role);
  const managesTeam = COMPANY_CAN.manageTeam.includes(user.role);

  const nav: NavLink[] = [
    { href: "/company", label: "Home", icon: "home" },
    { href: "/company/people", label: "People", icon: "tenants" },
    { href: "/company/requests", label: "Requests", icon: "requests", count: waiting || undefined },
    ...(seesBills ? [{ href: "/company/billing", label: "Bills" }] : []),
    ...(managesTeam ? [{ href: "/company/team", label: "Team" }] : []),
    { href: "/company/account", label: "Account", icon: "account" },
  ];
  // Phones: the first three get a tab, with Account last; the rest go under More.
  const tabs = [...nav.slice(0, 3), nav.at(-1)!];
  const more = nav.slice(3, -1);

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header className="no-print sticky top-0 z-30 border-b border-white/[0.06] bg-sidebar/95 pt-[env(safe-area-inset-top)] text-sidebar-foreground backdrop-blur">
        <div className="mx-auto flex h-12 max-w-4xl items-center justify-between gap-4 px-4 md:h-16">
          <Brand className="shrink-0 text-lg" />
          <TopTabs items={nav} />
          <div className="flex min-w-0 items-center gap-3">
            <p className="hidden min-w-0 truncate text-right text-xs text-sidebar-muted lg:block">{client.name}. {user.name}, {ROLE_LABELS[user.role]}</p>
            <form action={logout} className="shrink-0">
              <button className="-mr-2 flex min-h-11 items-center gap-2 whitespace-nowrap rounded-lg px-2 text-sm text-sidebar-muted transition-colors hover:bg-white/[0.06] hover:text-sidebar-foreground md:min-h-9">
                <Icon name="signout" className="size-[18px]" />
                Sign out
              </button>
            </form>
          </div>
        </div>
      </header>
      <BottomNav tabs={tabs} more={more.length ? [{ label: client.name, items: more }] : undefined} exact />
      <main className="mx-auto w-full max-w-4xl flex-1 px-4 pb-[calc(6rem+env(safe-area-inset-bottom))] pt-5 md:py-6">
        {children}
      </main>
    </div>
  );
}
