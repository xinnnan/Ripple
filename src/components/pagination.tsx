"use client";

import { cn } from "@/lib/utils";

/**
 * Page-numbered pagination. Use for any list that fetches a page at a time.
 *
 * - Shows prev / next + up to 5 page numbers
 * - For > 5 pages, first / last page is always shown, with ellipsis around the current window
 * - The "current page" pill is non-interactive
 */
export function Pagination({
  page,
  totalPages,
  onChange,
}: {
  page: number;
  totalPages: number;
  onChange: (page: number) => void;
}) {
  if (totalPages <= 1) return null;

  const window = buildPageWindow(page, totalPages);

  return (
    <div className="flex items-center justify-center gap-1 mt-4">
      <button
        onClick={() => onChange(Math.max(1, page - 1))}
        disabled={page <= 1}
        className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-accent transition-colors disabled:opacity-40 disabled:hover:bg-background"
      >
        ‹ Previous
      </button>
      {window.map((p, i) =>
        p === "..." ? (
          <span
            key={`ellipsis-${i}`}
            className="px-2 text-xs text-muted-foreground"
          >
            …
          </span>
        ) : (
          <button
            key={p}
            onClick={() => onChange(p)}
            aria-current={p === page ? "page" : undefined}
            className={cn(
              "rounded-lg px-3 py-1.5 text-xs font-medium transition-colors",
              p === page
                ? "bg-primary text-primary-foreground"
                : "border border-border text-foreground hover:bg-accent"
            )}
          >
            {p}
          </button>
        )
      )}
      <button
        onClick={() => onChange(Math.min(totalPages, page + 1))}
        disabled={page >= totalPages}
        className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-accent transition-colors disabled:opacity-40 disabled:hover:bg-background"
      >
        Next ›
      </button>
    </div>
  );
}

function buildPageWindow(current: number, total: number): (number | "...")[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);

  const window: (number | "...")[] = [1];
  if (current > 3) window.push("...");
  const start = Math.max(2, current - 1);
  const end = Math.min(total - 1, current + 1);
  for (let i = start; i <= end; i++) window.push(i);
  if (current < total - 2) window.push("...");
  window.push(total);
  return window;
}
