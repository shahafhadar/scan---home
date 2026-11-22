import { beforeEach, describe, expect, it, vi } from "vitest";

type FakeUser = { id: string; last_sign_in_at?: string } | null;
let user: FakeUser;
const rpc = vi.fn();
const signOut = vi.fn();

vi.mock("@/server/securityLog", () => ({ recordSecurityEvent: async () => {} }));
vi.mock("@/lib/supabase/server", () => ({
  supabaseServer: async () => ({
    auth: {
      getUser: async () => ({ data: { user } }),
      signOut: async () => {
        signOut();
        return { error: null };
      },
    },
    rpc: async (name: string) => {
      rpc(name);
      return { error: null };
    },
  }),
}));
const { POST } = await import("./route");

const recent = new Date().toISOString();
const stale = new Date(Date.now() - 60 * 60 * 1000).toISOString();

beforeEach(() => {
  rpc.mockReset();
  signOut.mockReset();
  user = { id: "u1", last_sign_in_at: recent };
});

describe("POST /api/account/delete", () => {
  it("closes the account and signs out when the sign-in is recent", async () => {
    const response = await POST();
    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("delete_my_account");
    expect(signOut).toHaveBeenCalled();
  });

  it("turns away a signed-out visitor", async () => {
    user = null;
    expect((await POST()).status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("requires a recent sign-in, and does not delete without one", async () => {
    user = { id: "u1", last_sign_in_at: stale };
    const response = await POST();
    expect(response.status).toBe(401);
    expect((await response.json()).error).toBe("reauth_required");
    expect(rpc).not.toHaveBeenCalled();
  });
});
