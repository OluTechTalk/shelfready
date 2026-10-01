"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/audit", label: "Audit" },
  { href: "/review", label: "Review" },
  { href: "/eval", label: "Eval" },
  { href: "/playground", label: "Playground" },
  { href: "/case-study", label: "Case study" },
  { href: "/status", label: "Status" },
];

export function NavLinks() {
  const pathname = usePathname();
  return (
    <nav aria-label="Main" className="-mr-2 flex min-w-0 items-center gap-1 overflow-x-auto whitespace-nowrap pr-2 text-sm">
      {LINKS.map((l) => {
        const active = pathname === l.href || pathname.startsWith(`${l.href}/`);
        return (
          <Link
            key={l.href}
            href={l.href}
            aria-current={active ? "page" : undefined}
            className={`rounded-md px-2.5 py-1.5 transition-colors ${active ? "bg-surface-muted font-medium" : "text-muted hover:bg-surface-muted hover:text-foreground"}`}
          >
            {l.label}
          </Link>
        );
      })}
    </nav>
  );
}
