import Link from "next/link";

export function Nav({ current }: { current: "list" | "devices" }) {
  const tab = (href: string, label: string, active: boolean) => (
    <Link
      href={href}
      className={`px-3 py-1.5 rounded-full text-sm ${active ? "bg-foreground text-background" : "opacity-70"}`}
    >
      {label}
    </Link>
  );
  return (
    <nav className="flex items-center gap-2 mb-6">
      <span className="font-bold me-auto">scan home</span>
      {tab("/", "רשימה", current === "list")}
      {tab("/devices", "מכשירים", current === "devices")}
    </nav>
  );
}
