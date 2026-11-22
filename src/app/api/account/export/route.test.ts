import { beforeEach, describe, expect, it, vi } from "vitest";

type FakeUser = { id: string; email?: string; phone?: string; created_at?: string } | null;
let user: FakeUser;
const selects: Record<string, string> = {};

vi.mock("@/lib/supabase/server", () => ({
  supabaseServer: async () => ({
    auth: { getUser: async () => ({ data: { user } }) },
    from: (name: string) => ({
      select: (cols: string) => {
        selects[name] = cols;
        return Promise.resolve({ data: [{ table: name }], error: null });
      },
    }),
  }),
}));
const { GET } = await import("./route");

beforeEach(() => {
  user = { id: "u1", email: "a@b.test", created_at: "2026-11-17T00:00:00Z" };
  for (const k of Object.keys(selects)) delete selects[k];
});

describe("GET /api/account/export", () => {
  it("returns the person's own data", async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown> & { account: { id: string } };
    expect(body.account.id).toBe("u1");
    expect(Array.isArray(body.lists)).toBe(true);
    expect(response.headers.get("content-disposition")).toContain("scan-home-export.json");
  });

  it("never exports the device secret or pairing code", async () => {
    await GET();
    expect(selects.devices).not.toContain("secret_hash");
    expect(selects.devices).not.toContain("pairing_code");
  });

  it("turns away a signed-out visitor", async () => {
    user = null;
    expect((await GET()).status).toBe(401);
  });
});
