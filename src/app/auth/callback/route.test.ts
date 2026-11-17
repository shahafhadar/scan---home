import { beforeEach, describe, expect, it, vi } from "vitest";

const verifyOtp = vi.fn();
const exchangeCodeForSession = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  supabaseServer: vi.fn(async () => ({ auth: { verifyOtp, exchangeCodeForSession } })),
}));
const { GET } = await import("./route");

const land = async (query: string) => {
  const response = await GET(new Request(`https://app.test/auth/callback${query}`));
  return new URL(response.headers.get("location") ?? "").pathname + new URL(response.headers.get("location") ?? "").search;
};

beforeEach(() => {
  verifyOtp.mockReset().mockResolvedValue({ error: null });
  exchangeCodeForSession.mockReset().mockResolvedValue({ error: null });
});

describe("/auth/callback", () => {
  it("hands a link with no query to the page that reads the URL fragment", async () => {
    // The default email puts the session in #access_token=…, which the server never sees.
    expect(await land("")).toBe("/auth/confirm");
    expect(verifyOtp).not.toHaveBeenCalled();
    expect(exchangeCodeForSession).not.toHaveBeenCalled();
  });

  it("verifies a token_hash link on the server", async () => {
    expect(await land("?token_hash=abc&type=email")).toBe("/");
    expect(verifyOtp).toHaveBeenCalledWith({ token_hash: "abc", type: "email" });
  });

  it("exchanges a PKCE code", async () => {
    expect(await land("?code=xyz")).toBe("/");
    expect(exchangeCodeForSession).toHaveBeenCalledWith("xyz");
  });

  it("sends a link that fails verification back to login with an error", async () => {
    verifyOtp.mockResolvedValue({ error: new Error("expired") });
    expect(await land("?token_hash=abc&type=email")).toBe("/login?error=link");
    exchangeCodeForSession.mockResolvedValue({ error: new Error("no verifier") });
    expect(await land("?code=xyz")).toBe("/login?error=link");
  });
});
