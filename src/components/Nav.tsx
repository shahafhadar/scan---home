import Link from "next/link";
import { Logo } from "./Logo";

export function Nav({ current }: { current: "list" | "devices" | "account" }) {
  const tab = (href: string, label: string, active: boolean) => (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${
        active ? "bg-surface text-foreground shadow-sm" : "text-muted"
      }`}
    >
      {label}
    </Link>
  );
  return (
    <nav className="flex items-center gap-3 mb-5">
      <Link href="/" className="flex items-center gap-2 me-auto">
        <Logo />
        <span className="font-bold tracking-tight">scan home</span>
      </Link>
      <div className="flex rounded-full bg-border/60 p-1">
        {tab("/", "רשימה", current === "list")}
        {tab("/devices", "מכשירים", current === "devices")}
      </div>
      <Link
        href="/account"
        aria-label="החשבון שלי"
        aria-current={current === "account" ? "page" : undefined}
        className={`size-9 grid place-items-center rounded-full ${current === "account" ? "bg-border/60 text-foreground" : "text-muted"}`}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
          <circle cx="12" cy="8" r="4" />
          <path d="M4 21c0-4 3.6-7 8-7s8 3 8 7" />
        </svg>
      </Link>
    </nav>
  );
}
