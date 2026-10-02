import { requireTenant } from "@/lib/auth";
import { BottomNav, type NavLink } from "../(app)/nav-links";
import { TopTabs } from "./top-tabs";
import { logout } from "./actions";
import { Brand } from "@/components/brand";

const NAV: NavLink[] = [
  { href: "/me", label: "Home", icon: "home" },
  { href: "/me/requests", label: "Requests", icon: "requests" },
  { href: "/me/rules", label: "House rules", icon: "rules" },
  { href: "/me/account", label: "Account", icon: "account" },
];

export default async function TenantLayout({ children }: LayoutProps<"/me">) {
  const { occupant } = await requireTenant();
  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header className="no-print sticky top-0 z-30 border-b border-white/10 bg-sidebar pt-[env(safe-area-inset-top)] text-sidebar-foreground md:static">
        <div className="mx-auto max-w-3xl">
          <div className="flex h-12 items-center justify-between gap-3 px-4 md:h-auto md:pb-2 md:pt-4">
            <div className="min-w-0">
              <Brand className="text-lg" />
              <p className="mt-1 hidden text-xs text-sidebar-muted md:block">{occupant.fullName}</p>
            </div>
            <form action={logout}>
              <button className="-mr-2 min-h-11 px-2 text-sm text-sidebar-muted underline-offset-2 hover:text-sidebar-foreground hover:underline md:min-h-0 md:text-xs">
                Sign out
              </button>
            </form>
          </div>
          <TopTabs items={NAV} />
        </div>
      </header>
      <BottomNav tabs={NAV} exact />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 pb-[calc(6rem+env(safe-area-inset-bottom))] pt-5 md:py-6">
        {children}
      </main>
    </div>
  );
}
