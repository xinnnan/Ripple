import Image from "next/image";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";

export function PublicSiteHeader({
  current,
}: {
  current?: "home" | "submit" | "login";
}) {
  return (
    <header className="sticky top-0 z-40 border-b border-slate-200/80 bg-white/95 backdrop-blur">
      <div className="mx-auto flex h-18 max-w-7xl items-center justify-between px-5 sm:px-6 lg:px-8">
        <Link
          href="/"
          className="flex items-center gap-3 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-4"
          aria-label="Ripple support home"
        >
          <Image
            src="/logo.png"
            alt=""
            width={36}
            height={36}
            className="rounded-xl"
            priority
          />
          <div className="leading-tight">
            <span className="block text-base font-semibold tracking-tight text-slate-950">
              Ripple
            </span>
            <span className="block text-[11px] font-medium uppercase tracking-[0.16em] text-slate-500">
              by DropletAI
            </span>
          </div>
        </Link>

        <nav
          className="hidden items-center gap-7 md:flex"
          aria-label="Primary navigation"
        >
          <Link
            href="/#how-it-works"
            className="text-sm font-medium text-slate-600 transition-colors hover:text-slate-950"
          >
            How it works
          </Link>
          <Link
            href="/#prepare"
            className="text-sm font-medium text-slate-600 transition-colors hover:text-slate-950"
          >
            What to include
          </Link>
          <Link
            href="/#support-channels"
            className="text-sm font-medium text-slate-600 transition-colors hover:text-slate-950"
          >
            Support channels
          </Link>
        </nav>

        <div className="flex items-center gap-2 sm:gap-3">
          <Link
            href="/login"
            aria-current={current === "login" ? "page" : undefined}
            className="rounded-lg px-3 py-2 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-100 hover:text-slate-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            Sign in
          </Link>
          <Link
            href="/submit"
            aria-current={current === "submit" ? "page" : undefined}
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3.5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 sm:px-4"
          >
            <span className="hidden sm:inline">Submit a ticket</span>
            <span className="sm:hidden">Submit</span>
            <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
          </Link>
        </div>
      </div>
    </header>
  );
}
