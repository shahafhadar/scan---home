import Link from "next/link";
import { Logo } from "./Logo";

export function Nav({ current }: { current: "list" | "devices" }) {
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
    </nav>
  );
}
