interface PageQueryError {
  code?: string;
}

interface PageQueryResult {
  error: PageQueryError | null;
}

/**
 * Fail an authenticated server page closed when one of its database reads
 * fails. Only stable error codes enter server logs; provider messages and
 * query details are intentionally excluded.
 */
export function assertPageQueriesSucceeded(
  context: string,
  ...results: PageQueryResult[]
): void {
  const codes = results
    .map((result) => result.error)
    .filter((error): error is PageQueryError => Boolean(error))
    .map((error) => error.code || "UNKNOWN");

  if (codes.length === 0) return;

  console.error(`[${context}] query failed:`, { codes });
  throw new Error("Page data is temporarily unavailable");
}
