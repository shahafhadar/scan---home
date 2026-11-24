import Link from "next/link";
import { Logo } from "./Logo";

export type Section = "list" | "devices" | "account";

const icon = (children: React.ReactNode) => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {children}
  </svg>
);

const tabs: { id: Section; href: string; label: string; icon: React.ReactNode }[] = [
  {
    id: "list",
    href: "/",
    label: "רשימה",
    icon: icon(
      <>
        <path d="m4 6 1.5 1.5L8 5" />
        <path d="m4 12 1.5 1.5L8 11" />
        <path d="m4 18 1.5 1.5L8 17" />
        <path d="M12 6.5h8M12 12.5h8M12 18.5h8" />
      </>,
    ),
  },
  {
    id: "devices",
    href: "/devices",
    label: "סורקים",
    icon: icon(
      <>
        <path d="M4 7v10M8 7v10M12 7v10M16 7v10M20 7v10" strokeWidth="1.6" />
        <path d="M3 4h18M3 20h18" />
      </>,
    ),
  },
  {
    id: "account",
    href: "/account",
    label: "חשבון",
    icon: icon(
      <>
        <circle cx="12" cy="8" r="4" />
        <path d="M4 21c0-4 3.6-7 8-7s8 3 8 7" />
      </>,
    ),
  },
];

/**
 * The frame around every signed-in screen. On a phone the three places sit in
 * a bar at the bottom, where a thumb reaches; on a computer they sit in the
 * header, and the content gets a comfortable width instead of a phone's.
 */
export function AppShell({ current, children }: { current: Section; children: React.ReactNode }) {
  return (
    <div className="min-h-dvh">
      <header className="border-b bg-surface/80 backdrop-blur md:sticky md:top-0 md:z-20">
        <div className="mx-auto flex max-w-lg md:max-w-3xl items-center gap-3 px-4 safe-top pb-3">
          <Link href="/" className="flex items-center gap-2 me-auto">
            <Logo />
            <span className="font-bold tracking-tight">scan home</span>
          </Link>
          <nav aria-label="ראשי" className="hidden md:flex rounded-full bg-border/60 p-1">
            {tabs.map((tab) => (
              <Link
                key={tab.id}
                href={tab.href}
                aria-current={tab.id === current ? "page" : undefined}
                className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${
                  tab.id === current ? "bg-surface text-foreground shadow-sm" : "text-muted hover:text-foreground"
                }`}
              >
                {tab.label}
              </Link>
            ))}
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-lg md:max-w-3xl px-4 pt-5 pb-[calc(var(--tabbar-h)+env(safe-area-inset-bottom)+1.5rem)] md:pb-12">
        {children}
      </main>

      <nav
        aria-label="ראשי"
        className="md:hidden fixed inset-x-0 bottom-0 z-20 border-t bg-surface/95 backdrop-blur pb-[env(safe-area-inset-bottom)]"
      >
        <div className="mx-auto max-w-lg grid grid-cols-3">
          {tabs.map((tab) => (
            <Link
              key={tab.id}
              href={tab.href}
              aria-current={tab.id === current ? "page" : undefined}
              className={`h-[var(--tabbar-h)] flex flex-col items-center justify-center gap-0.5 text-[11px] font-medium ${
                tab.id === current ? "text-accent" : "text-muted"
              }`}
            >
              {tab.icon}
              {tab.label}
            </Link>
          ))}
        </div>
      </nav>
    </div>
  );
}
