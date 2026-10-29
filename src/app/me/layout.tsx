import { requireTenant } from "@/lib/auth";
import { BottomNav, type NavLink } from "../(app)/nav-links";
import { TopTabs } from "./top-tabs";
import { logout } from "./actions";
import { Brand } from "@/components/brand";
import { Icon } from "@/components/icons";

const NAV: NavLink[] = [
  { href: "/me", label: "Home", icon: "home" },
  { href: "/me/requests", label: "Requests", icon: "requests" },
  { href: "/me/rules", label: "House rules", icon: "rules" },
  { href: "/me/account", label: "Account", icon: "account" },
];

export default async function TenantLayout({ children }: LayoutProps<"/me">) {
  const { user } = await requireTenant();
  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header className="no-print sticky top-0 z-30 border-b border-white/[0.06] bg-sidebar/95 pt-[env(safe-area-inset-top)] text-sidebar-foreground backdrop-blur">
        <div className="mx-auto flex h-12 max-w-3xl items-center justify-between gap-4 px-4 md:h-16">
          <Brand className="shrink-0 text-lg" />
          <TopTabs items={NAV} />
          <div className="flex min-w-0 items-center gap-3">
            <p className="hidden min-w-0 truncate text-right text-xs text-sidebar-muted lg:block">{user.name}</p>
            <form action={logout} className="shrink-0">
              <button className="-mr-2 flex min-h-11 items-center gap-2 whitespace-nowrap rounded-lg px-2 text-sm text-sidebar-muted transition-colors hover:bg-white/[0.06] hover:text-sidebar-foreground md:min-h-9">
                <Icon name="signout" className="size-[18px]" />
                Sign out
              </button>
            </form>
          </div>
        </div>
      </header>
      <BottomNav tabs={NAV} exact />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 pb-[calc(6rem+env(safe-area-inset-bottom))] pt-5 md:py-6">
        {children}
      </main>
    </div>
  );
}
