"use client";

import { useEffect, useRef, useState, type ComponentType } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Boxes,
  Building2,
  ClipboardList,
  Clock3,
  FileClock,
  LayoutDashboard,
  LogOut,
  MapPin,
  Menu,
  Package,
  Settings,
  ShieldCheck,
  Ticket,
  UserCircle,
  Users,
  Wrench,
  X,
} from "lucide-react";
import type { UserRole } from "@/types/ticket";
import { ROLE_LABELS } from "@/lib/roles";
import { cn } from "@/lib/utils";

interface AppShellProps {
  children: React.ReactNode;
  role: UserRole;
  email: string;
  isAdmin: boolean;
  isManager: boolean;
  isInternal: boolean;
}

interface NavItem {
  href: string;
  label: string;
  icon: ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
}

const primaryItems: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/tickets", label: "Tickets", icon: Ticket },
];

const adminItems: NavItem[] = [
  {
    href: "/admin/customers-sites",
    label: "Customers & Sites",
    icon: Building2,
  },
  { href: "/admin/users", label: "Users", icon: Users },
  { href: "/admin/spare-parts", label: "Spare Parts", icon: Package },
  { href: "/admin/inventory", label: "Inventory", icon: Boxes },
  {
    href: "/admin/part-requests",
    label: "Part Requests",
    icon: ClipboardList,
  },
  { href: "/admin/field-service", label: "Field Service", icon: Wrench },
  { href: "/admin/sla-policies", label: "SLA Policies", icon: Clock3 },
  { href: "/admin/audit", label: "Audit Log", icon: FileClock },
];

function isCurrentPath(pathname: string, href: string) {
  if (href === "/dashboard") return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function AppShell({
  children,
  role,
  email,
  isAdmin,
  isManager,
  isInternal,
}: AppShellProps) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const mobileTriggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!mobileOpen) return;
    const previous = document.body.style.overflow;
    const mobileTrigger = mobileTriggerRef.current;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMobileOpen(false);
    };

    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", handleKeyDown);
    window.requestAnimationFrame(() => {
      document
        .querySelector<HTMLButtonElement>(
          "#mobile-navigation button[aria-label='Close navigation']"
        )
        ?.focus();
    });

    return () => {
      document.body.style.overflow = previous;
      document.removeEventListener("keydown", handleKeyDown);
      mobileTrigger?.focus();
    };
  }, [mobileOpen]);

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  const roleItems: NavItem[] = [];
  if (!isInternal) {
    roleItems.push({ href: "/sites", label: "My Sites", icon: MapPin });
  }
  if (isManager) {
    roleItems.push({ href: "/team", label: "Team", icon: Users });
  }

  const sidebar = (
    <div className="flex h-full flex-col bg-slate-950 text-slate-300">
      <div className="flex h-20 items-center justify-between border-b border-white/10 px-5">
        <Link
          href="/dashboard"
          className="flex min-h-11 items-center gap-3 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lime-400"
        >
          <Image
            src="/logo.png"
            alt=""
            width={38}
            height={38}
            className="rounded-xl bg-white"
            priority
          />
          <div className="leading-tight">
            <span className="block font-semibold text-white">Ripple</span>
            <span className="block text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
              Service operations
            </span>
          </div>
        </Link>
        <button
          type="button"
          onClick={() => setMobileOpen(false)}
          aria-label="Close navigation"
          className="inline-flex h-11 w-11 items-center justify-center rounded-lg text-slate-400 hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lime-400 lg:hidden"
        >
          <X className="h-5 w-5" aria-hidden="true" />
        </button>
      </div>

      <nav
        className="flex-1 space-y-6 overflow-y-auto px-3 py-5"
        aria-label="Application navigation"
      >
        <NavGroup
          items={primaryItems}
          pathname={pathname}
          onNavigate={() => setMobileOpen(false)}
        />

        {roleItems.length > 0 && (
          <NavGroup
            label="Workspace"
            items={roleItems}
            pathname={pathname}
            onNavigate={() => setMobileOpen(false)}
          />
        )}

        {isAdmin && (
          <NavGroup
            label="Administration"
            items={adminItems}
            pathname={pathname}
            onNavigate={() => setMobileOpen(false)}
          />
        )}
      </nav>

      <div className="border-t border-white/10 p-3">
        <NavGroup
          items={[
            ...(isInternal
              ? [
                  {
                    href: "/settings",
                    label: "System status",
                    icon: Settings,
                  },
                ]
              : []),
            { href: "/profile", label: "Profile", icon: UserCircle },
          ]}
          pathname={pathname}
          onNavigate={() => setMobileOpen(false)}
        />
        <div className="mx-2 mt-3 border-t border-white/10 pt-4">
          <div className="flex items-center gap-3 px-2">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-lime-400/15 text-lime-300">
              <ShieldCheck className="h-4 w-4" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <p className="truncate text-xs font-semibold text-white">
                {ROLE_LABELS[role] ?? role}
              </p>
              <p className="truncate text-[11px] text-slate-500">{email}</p>
            </div>
          </div>
          <form action="/auth/logout" method="POST" className="mt-3">
            <button
              type="submit"
              className="flex min-h-11 w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-slate-400 transition hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lime-400"
            >
              <LogOut className="h-4 w-4" aria-hidden="true" />
              Sign out
            </button>
          </form>
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-[#f7f9f6] lg:flex">
      <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-slate-200 bg-white/95 px-4 backdrop-blur lg:hidden">
        <button
          ref={mobileTriggerRef}
          type="button"
          onClick={() => setMobileOpen(true)}
          aria-label="Open navigation"
          aria-expanded={mobileOpen}
          aria-controls="mobile-navigation"
          className="inline-flex h-11 w-11 items-center justify-center rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          <Menu className="h-5 w-5" aria-hidden="true" />
        </button>
        <Link
          href="/dashboard"
          className="flex min-h-11 items-center gap-2 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          <Image
            src="/logo.png"
            alt=""
            width={30}
            height={30}
            className="rounded-lg"
          />
          <span className="font-semibold text-slate-950">Ripple</span>
        </Link>
        <Link
          href="/tickets"
          className="inline-flex min-h-11 items-center rounded-lg bg-primary px-3 py-2 text-xs font-bold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
        >
          Tickets
        </Link>
      </header>

      <aside className="sticky top-0 hidden h-screen w-72 shrink-0 lg:block">
        {sidebar}
      </aside>

      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            aria-label="Close navigation overlay"
            onClick={() => setMobileOpen(false)}
            className="absolute inset-0 bg-slate-950/60 backdrop-blur-sm"
          />
          <aside
            id="mobile-navigation"
            role="dialog"
            aria-modal="true"
            aria-label="Application navigation"
            className="relative h-full w-[min(86vw,320px)] shadow-2xl"
          >
            {sidebar}
          </aside>
        </div>
      )}

      <main className="min-w-0 flex-1">{children}</main>
    </div>
  );
}

function NavGroup({
  label,
  items,
  pathname,
  onNavigate,
}: {
  label?: string;
  items: NavItem[];
  pathname: string;
  onNavigate: () => void;
}) {
  return (
    <div>
      {label && (
        <p className="mb-2 px-3 text-[10px] font-bold uppercase tracking-[0.18em] text-slate-600">
          {label}
        </p>
      )}
      <div className="space-y-1">
        {items.map((item) => {
          const Icon = item.icon;
          const active = isCurrentPath(pathname, item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onNavigate}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex min-h-11 items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lime-400",
                active
                  ? "bg-lime-400 text-slate-950 shadow-sm"
                  : "text-slate-400 hover:bg-white/10 hover:text-white"
              )}
            >
              <Icon className="h-4 w-4 shrink-0" aria-hidden={true} />
              {item.label}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
