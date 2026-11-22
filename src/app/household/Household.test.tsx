import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }) }));

const members = [
  { user_id: "me", email: "me@example.test", role: "owner" },
  { user_id: "other", email: "other@example.test", role: "member" },
];
const rpc = vi.fn();
const table = (rows: unknown[]) => {
  const chain: Record<string, unknown> = {};
  for (const m of ["select", "eq", "is"]) chain[m] = () => chain;
  chain.then = (resolve: (v: unknown) => void) => resolve({ data: rows, error: null });
  return chain;
};
vi.mock("@/lib/supabase/client", () => ({
  supabaseBrowser: () => ({
    rpc: (name: string, args?: unknown) => {
      rpc(name, args);
      if (name === "list_household_members") return Promise.resolve({ data: members, error: null });
      return Promise.resolve({ data: "ok", error: null });
    },
    from: () => table([]),
  }),
}));
const { Household } = await import("./Household");

beforeEach(() => rpc.mockReset());
afterEach(() => cleanup());

describe("Household", () => {
  it("lists members and shows owner-only controls for others, not for myself", async () => {
    render(<Household householdId="h1" myRole="owner" myUserId="me" />);
    expect(await screen.findByText("me@example.test (אתם)")).toBeTruthy();
    expect(await screen.findByText("other@example.test")).toBeTruthy();
    expect(screen.getByText("הסרה")).toBeTruthy(); // only for "other"
  });

  it("hides owner controls for a non-owner", async () => {
    render(<Household householdId="h1" myRole="member" myUserId="me" />);
    await waitFor(() => expect(screen.queryByText("הזמנת אדם")).toBeNull());
    expect(screen.queryByText("הסרה")).toBeNull();
  });

  it("has nothing to manage without a household", () => {
    render(<Household householdId={null} myRole={null} myUserId="me" />);
    expect(screen.getByText("אין משק בית לנהל.")).toBeTruthy();
  });
});
