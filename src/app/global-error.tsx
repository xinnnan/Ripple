"use client";

import { useEffect } from "react";
import "@/styles/globals.css";

/**
 * Last-resort boundary for failures in the root layout itself. It replaces the
 * whole document, so it renders its own <html>/<body> and avoids components
 * that depend on the layout.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[ripple] root layout failure:", error.digest ?? error.name);
  }, [error]);

  return (
    <html lang="en">
      <body className="antialiased">
        <main className="flex min-h-screen items-center justify-center bg-background px-4">
          <div className="w-full max-w-md text-center">
            <h1 className="mb-2 text-xl font-semibold text-foreground">
              Something went wrong
            </h1>
            <p className="mb-6 text-sm text-muted-foreground">
              Ripple could not load this page. Retry, or come back in a few
              minutes if the problem continues.
            </p>
            {error.digest && (
              <p className="mb-4 font-mono text-xs text-muted-foreground/70">
                ref: {error.digest}
              </p>
            )}
            <div className="flex justify-center gap-2">
              <button
                type="button"
                onClick={reset}
                className="min-h-11 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
              >
                Try again
              </button>
              {/* A plain anchor forces a fresh document after a layout crash. */}
              {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
              <a
                href="/"
                className="inline-flex min-h-11 items-center rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-accent"
              >
                Home
              </a>
            </div>
          </div>
        </main>
      </body>
    </html>
  );
}
