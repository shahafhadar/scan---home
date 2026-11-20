import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const updateUser = vi.fn();
const verifyOtp = vi.fn();
const refresh = vi.fn();
vi.mock("@/lib/supabase/client", () => ({ supabaseBrowser: () => ({ auth: { updateUser, verifyOtp, signOut: vi.fn() } }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), refresh }) }));
vi.stubEnv("NEXT_PUBLIC_SMS_LOGIN", "true");

const { Account } = await import("./Account");

const ok = { error: null };
const fail = (error: object) => ({ error });
const NUMBER_BOX = () => screen.getByPlaceholderText("050-123-4567");
const CODE_BOX = () => screen.getByLabelText("קוד מההודעה") as HTMLInputElement;

const open = (phone: string | null = null) => {
  render(<Account email="a@example.com" phone={phone} />);
  fireEvent.click(screen.getByText(phone ? "החלפה" : "+ הוספת מספר נייד"));
};
const submitNumber = async (number: string) => {
  fireEvent.change(NUMBER_BOX(), { target: { value: number } });
  fireEvent.click(screen.getByText("שלחו לי קוד"));
};

beforeEach(() => {
  updateUser.mockReset().mockResolvedValue(ok);
  verifyOtp.mockReset().mockResolvedValue(ok);
  refresh.mockReset();
});
afterEach(cleanup);

describe("adding a phone number to the account", () => {
  it("refuses a number that is not a mobile", async () => {
    open();
    await submitNumber("02-123-4567");
    expect(screen.getByText(/המספר לא נראה תקין/)).toBeTruthy();
    expect(updateUser).not.toHaveBeenCalled();
  });

  it("does not text the number the account already has", async () => {
    open("+972501234567");
    await submitNumber("050 123 4567");
    expect(updateUser).not.toHaveBeenCalled();
    expect(screen.getByText("050-123-4567")).toBeTruthy();
  });

  it("says the number belongs to another account", async () => {
    updateUser.mockResolvedValue(fail({ code: "phone_exists", status: 422 }));
    open();
    await submitNumber("052-123-4567");
    expect(await screen.findByText(/כבר משויך לחשבון אחר/)).toBeTruthy();
  });

  it("says how long to wait when a code was just sent", async () => {
    updateUser.mockResolvedValue(
      fail({ code: "over_sms_send_rate_limit", status: 429, message: "you can only request this after 33 seconds" }),
    );
    open();
    await submitNumber("052-123-4567");
    expect(await screen.findByText(/בעוד 33 שניות/)).toBeTruthy();
  });

  it("confirms with the code and shows the new number", async () => {
    open();
    await submitNumber("052-123-4567");
    await screen.findByLabelText("קוד מההודעה");
    expect(updateUser).toHaveBeenCalledWith({ phone: "+972521234567" });
    fireEvent.change(CODE_BOX(), { target: { value: "654 321" } });
    await waitFor(() => expect(verifyOtp).toHaveBeenCalledWith({ phone: "+972521234567", token: "654321", type: "phone_change" }));
    expect(await screen.findByText("052-123-4567")).toBeTruthy();
    expect(refresh).toHaveBeenCalled();
  });

  it("clears a wrong code but keeps one that was lost to a dropped connection", async () => {
    verifyOtp
      .mockResolvedValueOnce(fail({ code: "otp_expired", status: 403 }))
      .mockResolvedValueOnce(fail({ name: "AuthRetryableFetchError", status: 0 }));
    open();
    await submitNumber("052-123-4567");
    await screen.findByLabelText("קוד מההודעה");

    fireEvent.change(CODE_BOX(), { target: { value: "111111" } });
    expect(await screen.findByText(/הקוד לא נכון או שפג תוקפו/)).toBeTruthy();
    expect(CODE_BOX().value).toBe("");

    fireEvent.change(CODE_BOX(), { target: { value: "222222" } });
    expect(await screen.findByText(/הקוד שהקלדתם נשמר/)).toBeTruthy();
    expect(CODE_BOX().value).toBe("222222");
  });
});
