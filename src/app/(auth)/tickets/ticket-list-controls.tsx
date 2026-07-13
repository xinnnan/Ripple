"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useCallback, useTransition } from "react";
import { Pagination } from "@/components/pagination";
import {
  TicketFilters,
  PAGE_SIZE,
  parseFilters,
  buildParams,
  type TicketFiltersState,
  type TicketFilterOptions,
} from "./ticket-filters";

/**
 * Client wrapper that owns the URL <-> filter state for the tickets list.
 * Renders the filter bar and pagination, and re-navigates the page whenever
 * the user changes a filter. The server component is responsible for the
 * actual data fetch — this component only owns the URL state.
 */
export function TicketListControls({
  totalCount,
  options,
}: {
  totalCount: number;
  options: TicketFilterOptions;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();

  const filters = parseFilters(new URLSearchParams(searchParams.toString()));
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  const apply = useCallback(
    (next: TicketFiltersState) => {
      const qs = buildParams(next);
      startTransition(() => {
        router.push(`${pathname}${qs}`);
      });
    },
    [pathname, router]
  );

  return (
    <>
      <TicketFilters
        filters={filters}
        options={options}
        totalCount={totalCount}
        onChange={apply}
      />
      <Pagination
        page={filters.page || 1}
        totalPages={totalPages}
        onChange={(p) => apply({ ...filters, page: p })}
      />
    </>
  );
}
