import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const replace = vi.fn();
const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace, refresh }) }));

const signInWithOtp = vi.fn();
const verifyOtp = vi.fn();
vi.mock("@/lib/supabase/client", () => ({
  supabaseBrowser: () => ({ auth: { signInWithOtp, verifyOtp } }),
}));

const { PhoneLogin } = await import("./PhoneLogin");

beforeEach(() => {
  replace.mockReset();
  refresh.mockReset();
  signInWithOtp.mockReset().mockResolvedValue({ error: null });
  // First verify succeeds; a second call (should not happen) would error, which
  // is exactly the false "wrong code" the fix must prevent.
  verifyOtp.mockReset();
  verifyOtp.mockResolvedValueOnce({ error: null });
  verifyOtp.mockResolvedValue({ error: { message: "token has expired or is invalid", code: "otp_expired", status: 403 } });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const reachCodeStep = async () => {
  render(<PhoneLogin />);
  fireEvent.change(screen.getByPlaceholderText("050-123-4567"), { target: { value: "0501234567" } });
  fireEvent.click(screen.getByRole("button", { name: "שלחו לי קוד" }));
  return screen.findByLabelText("קוד מההודעה");
};

describe("PhoneLogin", () => {
  it("verifies once and signs in when the six digits are entered", async () => {
    const codeInput = await reachCodeStep();
    fireEvent.change(codeInput, { target: { value: "123456" } });
    await waitFor(() => expect(verifyOtp).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/"));
    expect(verifyOtp).toHaveBeenCalledWith({ phone: "+972501234567", token: "123456", type: "sms" });
  });

  it("does not re-verify after success, so a second submit cannot show a false error", async () => {
    const codeInput = await reachCodeStep();
    fireEvent.change(codeInput, { target: { value: "123456" } }); // auto-submits at six digits
    await waitFor(() => expect(verifyOtp).toHaveBeenCalledTimes(1));

    // A late autofill change / Enter / button press fires the form again.
    fireEvent.submit(codeInput.closest("form")!);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(verifyOtp).toHaveBeenCalledTimes(1); // the lock held
    expect(screen.queryByText(/הקוד לא נכון/)).toBeNull();
  });
});
