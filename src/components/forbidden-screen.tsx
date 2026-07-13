import Link from "next/link";

/**
 * Reusable "you don't have permission to see this" screen. Use anywhere a
 * user hits a page they don't have the role for. Stays inside the existing
 * app shell so the user can navigate back.
 */
export function ForbiddenScreen({
  title = "You don't have access",
  description = "Your account doesn't have permission to view this page. If you think this is wrong, contact your admin.",
}: {
  title?: string;
  description?: string;
}) {
  return (
    <div className="p-8 max-w-lg mx-auto text-center pt-24">
      <div className="mx-auto h-12 w-12 rounded-full bg-amber-100 flex items-center justify-center mb-4">
        <svg
          className="h-6 w-6 text-amber-600"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={1.5}
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z"
          />
        </svg>
      </div>
      <h1 className="text-lg font-semibold text-foreground mb-2">{title}</h1>
      <p className="text-sm text-muted-foreground mb-6">{description}</p>
      <Link
        href="/dashboard"
        className="inline-block rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
      >
        Back to dashboard
      </Link>
    </div>
  );
}
