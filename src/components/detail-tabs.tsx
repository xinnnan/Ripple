"use client";

import Link from "next/link";
import { cn } from "@/lib/utils";

export type DetailTab = {
  key: string;
  label: string;
  count?: number;
};

/**
 * Tab nav for detail pages. Tab state lives in the URL (?tab=...), so the
 * server can render the right panel on reload / deep-link.
 *
 * Usage:
 *   <DetailTabs current={tab} basePath={`/admin/sites/${id}`} tabs={[
 *     { key: "overview", label: "Overview" },
 *     { key: "tickets", label: "Tickets", count: tickets.length },
 *   ]} />
 */
export function DetailTabs({
  current,
  basePath,
  tabs,
}: {
  current: string;
  basePath: string;
  tabs: DetailTab[];
}) {
  return (
    <div className="border-b border-border mb-6">
      <nav className="flex gap-1 overflow-x-auto">
        {tabs.map((t, i) => {
          const active = current === t.key;
          const href = i === 0 ? basePath : `${basePath}?tab=${t.key}`;
          return (
            <Link
              key={t.key}
              href={href}
              className={cn(
                "px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors whitespace-nowrap",
                active
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground hover:border-border"
              )}
            >
              {t.label}
              {typeof t.count === "number" && (
                <span
                  className={cn(
                    "ml-2 inline-flex items-center rounded-full px-2 py-0.5 text-xs",
                    active
                      ? "bg-primary/10 text-primary"
                      : "bg-muted text-muted-foreground"
                  )}
                >
                  {t.count}
                </span>
              )}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}

/**
 * Helper for server components to read the current tab from the URL.
 * Defaults to the first tab.
 */
export function getCurrentTab(
  searchParams: { tab?: string | string[] } | undefined,
  fallback: string
): string {
  const t = searchParams?.tab;
  if (typeof t === "string") return t;
  return fallback;
}
