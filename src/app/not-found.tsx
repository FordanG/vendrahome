import { getCurrentStaff, homeFor } from "@/lib/auth";
import { LinkButton } from "@/components/ui";

// Addresses that match no page at all, for anyone (signed in or not).
export default async function NotFound() {
  const user = await getCurrentStaff();
  const home = user ? homeFor(user) : "/login";
  return (
    <main className="flex flex-1 items-center justify-center p-4">
      <div className="max-w-md text-center">
        <h1 className="plate text-3xl font-bold">Page not found</h1>
        <p className="mt-2 text-sm text-muted">There&apos;s nothing at this address. Check the link and try again.</p>
        <LinkButton href={home} className="mt-6">
          {user ? "Go to my home page" : "Go to sign in"}
        </LinkButton>
      </div>
    </main>
  );
}
