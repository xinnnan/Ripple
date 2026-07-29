import Image from "next/image";
import Link from "next/link";

export function PublicSiteFooter() {
  return (
    <footer className="border-t border-slate-200 bg-slate-950 text-slate-300">
      <div className="mx-auto grid max-w-7xl gap-8 px-6 py-10 md:grid-cols-[1fr_auto] md:items-end lg:px-8">
        <div>
          <Link
            href="/"
            className="inline-flex items-center gap-3 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lime-400"
          >
            <Image
              src="/logo.png"
              alt=""
              width={34}
              height={34}
              className="rounded-xl bg-white"
            />
            <span className="font-semibold text-white">Ripple by DropletAI</span>
          </Link>
          <p className="mt-4 max-w-xl text-sm leading-6 text-slate-400">
            Service coordination for industrial automation deployments—from
            first report through engineering response, parts, and field work.
          </p>
        </div>
        <div className="flex flex-wrap gap-x-6 gap-y-3 text-sm">
          <Link href="/submit" className="hover:text-white">
            Submit a ticket
          </Link>
          <Link href="/login" className="hover:text-white">
            Sign in
          </Link>
          <a
            href="mailto:support@dropletai.services"
            className="hover:text-white"
          >
            support@dropletai.services
          </a>
        </div>
      </div>
      <div className="border-t border-white/10">
        <div className="mx-auto max-w-7xl px-6 py-5 text-xs text-slate-500 lg:px-8">
          © {new Date().getFullYear()} DropletAI Services. All rights reserved.
        </div>
      </div>
    </footer>
  );
}
