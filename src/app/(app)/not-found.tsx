import { LinkButton } from "@/components/ui";

// Shown for pages that don't exist, and for pages this person's role can't use:
// both look the same, so nobody learns what is behind a page they can't open.
export default function NotFound() {
  return (
    <div className="mx-auto max-w-md py-16 text-center">
      <h1 className="plate text-3xl font-bold">Page not found</h1>
      <p className="mt-2 text-sm text-muted">There&apos;s nothing at this address. Check the link, or go back to the room board.</p>
      <LinkButton href="/" className="mt-6">
        Go to the room board
      </LinkButton>
    </div>
  );
}
