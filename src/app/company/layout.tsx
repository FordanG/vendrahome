import { and, count, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { COMPANY_CAN, requireCompany, ROLE_LABELS } from "@/lib/auth";
import { companyRequestScope } from "@/lib/company";
import { BottomNav, type NavLink } from "../(app)/nav-links";
import { TopTabs } from "../me/top-tabs";
import { logout } from "./actions";
import { Brand } from "@/components/brand";

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
      <header className="no-print sticky top-0 z-30 border-b border-white/10 bg-sidebar pt-[env(safe-area-inset-top)] text-sidebar-foreground md:static">
        <div className="mx-auto max-w-4xl">
          <div className="flex h-12 items-center justify-between gap-3 px-4 md:h-auto md:pb-2 md:pt-4">
            <div className="min-w-0">
              <Brand className="text-lg" />
              <p className="mt-1 hidden break-words text-xs text-sidebar-muted md:block">
                {client.name}. {user.name}, {ROLE_LABELS[user.role]}
              </p>
            </div>
            <form action={logout} className="shrink-0">
              <button className="-mr-2 min-h-11 whitespace-nowrap px-2 text-sm text-sidebar-muted underline-offset-2 hover:text-sidebar-foreground hover:underline md:min-h-0 md:text-xs">
                Sign out
              </button>
            </form>
          </div>
          <TopTabs items={nav} />
        </div>
      </header>
      <BottomNav tabs={tabs} more={more.length ? [{ label: client.name, items: more }] : undefined} exact />
      <main className="mx-auto w-full max-w-4xl flex-1 px-4 pb-[calc(6rem+env(safe-area-inset-bottom))] pt-5 md:py-6">
        {children}
      </main>
    </div>
  );
}
