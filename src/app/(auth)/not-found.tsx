import Link from "next/link";

/**
 * In-app 404 for authenticated routes. Keeps the sidebar layout so the user
 * stays oriented.
 */
export default function AuthNotFound() {
  return (
    <div className="p-8 max-w-lg mx-auto text-center pt-24">
      <p className="text-5xl font-bold text-muted-foreground/30 mb-2">404</p>
      <h1 className="text-lg font-semibold text-foreground mb-2">
        Not found
      </h1>
      <p className="text-sm text-muted-foreground mb-6">
        This page or record doesn&apos;t exist, or you don&apos;t have access
        to it.
      </p>
      <div className="flex gap-2 justify-center">
        <Link
          href="/tickets"
          className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-accent transition-colors"
        >
          Browse tickets
        </Link>
        <Link
          href="/dashboard"
          className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          Dashboard
        </Link>
      </div>
    </div>
  );
}
