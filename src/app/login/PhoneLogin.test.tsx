import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const signInWithOtp = vi.fn();
const verifyOtp = vi.fn();
const replace = vi.fn();
vi.mock("@/lib/supabase/client", () => ({ supabaseBrowser: () => ({ auth: { signInWithOtp, verifyOtp } }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace, refresh: vi.fn() }) }));

const { PhoneLogin } = await import("./PhoneLogin");

const ok = { error: null };
const fail = (error: object) => ({ error });
const NUMBER_BOX = () => screen.getByPlaceholderText("050-123-4567");
const CODE_BOX = () => screen.getByLabelText("קוד מההודעה") as HTMLInputElement;

const askForCode = async (number = "050-123-4567") => {
  fireEvent.change(NUMBER_BOX(), { target: { value: number } });
  fireEvent.click(screen.getByText("שלחו לי קוד"));
  await waitFor(() => expect(signInWithOtp).toHaveBeenCalled());
};

beforeEach(() => {
  signInWithOtp.mockReset().mockResolvedValue(ok);
  verifyOtp.mockReset().mockResolvedValue(ok);
  replace.mockReset();
  localStorage.clear();
});
afterEach(cleanup);

describe("PhoneLogin: asking for a code", () => {
  it("refuses a number that is not an Israeli mobile, without calling the server", () => {
    render(<PhoneLogin />);
    fireEvent.change(NUMBER_BOX(), { target: { value: "03-123-4567" } });
    fireEvent.click(screen.getByText("שלחו לי קוד"));
    expect(screen.getByText(/המספר לא נראה תקין/)).toBeTruthy();
    expect(signInWithOtp).not.toHaveBeenCalled();
  });

  it("sends the number in international form, however it was typed", async () => {
    render(<PhoneLogin />);
    await askForCode("٠٥٠-١٢٣-٤٥٦٧");
    expect(signInWithOtp).toHaveBeenCalledWith({ phone: "+972501234567" });
    await screen.findByLabelText("קוד מההודעה");
  });

  it("says how long until a new code can be asked for", async () => {
    render(<PhoneLogin />);
    await askForCode();
    expect(await screen.findByText("שליחה מחדש בעוד 60 שניות")).toBeTruthy();
  });

  it("goes to the code box when a code was sent a moment ago, since that code still works", async () => {
    signInWithOtp.mockResolvedValue(
      fail({ code: "over_sms_send_rate_limit", status: 429, message: "For security purposes, you can only request this after 41 seconds." }),
    );
    render(<PhoneLogin />);
    await askForCode();
    await screen.findByLabelText("קוד מההודעה");
    expect(screen.getByText("שליחה מחדש בעוד 41 שניות")).toBeTruthy();
    expect(screen.getByText(/שלחנו קוד ממש עכשיו/)).toBeTruthy();
  });

  it("says so when phone sign-in is not switched on, and stays on the number", async () => {
    signInWithOtp.mockResolvedValue(fail({ code: "phone_provider_disabled", status: 422 }));
    render(<PhoneLogin onUseEmail={() => {}} />);
    await askForCode();
    expect(await screen.findByText(/עוד לא פעילה/)).toBeTruthy();
    expect(screen.queryByLabelText("קוד מההודעה")).toBeNull();
  });

  it("offers email when the text cannot be sent", async () => {
    signInWithOtp.mockResolvedValue(fail({ code: "unexpected_failure", status: 500 }));
    const onUseEmail = vi.fn();
    render(<PhoneLogin onUseEmail={onUseEmail} />);
    await askForCode();
    fireEvent.click(await screen.findByText("להיכנס עם מייל במקום"));
    expect(onUseEmail).toHaveBeenCalled();
  });

  it("says there is no connection, not that sending failed", async () => {
    signInWithOtp.mockResolvedValue(fail({ name: "AuthRetryableFetchError", status: 0, message: "Failed to fetch" }));
    render(<PhoneLogin />);
    await askForCode();
    expect(await screen.findByText(/אין חיבור לאינטרנט/)).toBeTruthy();
  });
});

describe("PhoneLogin: typing the code", () => {
  const toCodeBox = async () => {
    render(<PhoneLogin />);
    await askForCode();
    await screen.findByLabelText("קוד מההודעה");
  };

  it("signs in as soon as the sixth digit is there", async () => {
    await toCodeBox();
    fireEvent.change(CODE_BOX(), { target: { value: "123456" } });
    await waitFor(() => expect(verifyOtp).toHaveBeenCalledWith({ phone: "+972501234567", token: "123456", type: "sms" }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/"));
    expect(localStorage.getItem("scan-home-otp-pending")).toBeNull();
  });

  it.each([
    ["123 456", "123456"],
    ["١٢٣٤٥٦", "123456"],
    ["‎123456‏", "123456"],
  ])("takes %j as the code %s", async (typed, token) => {
    await toCodeBox();
    fireEvent.change(CODE_BOX(), { target: { value: typed } });
    await waitFor(() => expect(verifyOtp).toHaveBeenCalledWith(expect.objectContaining({ token })));
  });

  it("clears a wrong code and says so", async () => {
    verifyOtp.mockResolvedValue(fail({ code: "otp_expired", status: 403, message: "Token has expired or is invalid" }));
    await toCodeBox();
    fireEvent.change(CODE_BOX(), { target: { value: "111111" } });
    expect(await screen.findByText(/הקוד לא נכון או שפג תוקפו/)).toBeTruthy();
    expect(CODE_BOX().value).toBe("");
    expect(replace).not.toHaveBeenCalled();
  });

  it("keeps the code when the connection drops, and lets them try again", async () => {
    verifyOtp.mockResolvedValueOnce(fail({ name: "AuthRetryableFetchError", status: 0 }));
    await toCodeBox();
    fireEvent.change(CODE_BOX(), { target: { value: "123456" } });
    expect(await screen.findByText(/הקוד שהקלדתם נשמר/)).toBeTruthy();
    expect(CODE_BOX().value).toBe("123456");
    fireEvent.click(screen.getByText("כניסה"));
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/"));
  });

  it("does not ask the server twice for one code", async () => {
    let finish: (value: unknown) => void = () => {};
    verifyOtp.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    await toCodeBox();
    fireEvent.change(CODE_BOX(), { target: { value: "123456" } });
    fireEvent.submit(CODE_BOX().closest("form")!);
    await act(async () => finish(ok));
    expect(verifyOtp).toHaveBeenCalledTimes(1);
  });

  it("stops accepting codes after five wrong ones and points to a new code", async () => {
    verifyOtp.mockResolvedValue(fail({ code: "otp_expired", status: 403 }));
    await toCodeBox();
    for (let i = 0; i < 5; i++) {
      fireEvent.change(CODE_BOX(), { target: { value: "11111" + i } });
      await waitFor(() => expect(verifyOtp).toHaveBeenCalledTimes(i + 1));
      await waitFor(() => expect(CODE_BOX().value).toBe(""));
    }
    expect(await screen.findByText(/טעיתם כמה פעמים/)).toBeTruthy();
    fireEvent.change(CODE_BOX(), { target: { value: "222222" } });
    await act(async () => {});
    expect(verifyOtp).toHaveBeenCalledTimes(5);
  });

  it("lets them go back and use another number", async () => {
    await toCodeBox();
    fireEvent.click(screen.getByText("מספר אחר"));
    expect(NUMBER_BOX()).toBeTruthy();
    expect(localStorage.getItem("scan-home-otp-pending")).toBeNull();
  });
});

describe("PhoneLogin: coming back from the messages app", () => {
  it("is still on the code box after a reload, with the wait that is left", async () => {
    localStorage.setItem("scan-home-otp-pending", JSON.stringify({ phone: "+972501234567", at: Date.now() - 20_000 }));
    render(<PhoneLogin />);
    await screen.findByLabelText("קוד מההודעה");
    expect(screen.getByText(/שליחה מחדש בעוד 4\d שניות/)).toBeTruthy();
    expect(screen.getByText("050-123-4567")).toBeTruthy();
  });

  it("offers email once a minute has passed with no text, and not before", async () => {
    localStorage.setItem("scan-home-otp-pending", JSON.stringify({ phone: "+972501234567", at: Date.now() - 20_000 }));
    const { unmount } = render(<PhoneLogin onUseEmail={() => {}} />);
    await screen.findByLabelText("קוד מההודעה");
    expect(screen.queryByText("להיכנס עם מייל במקום")).toBeNull();
    unmount();
    localStorage.setItem("scan-home-otp-pending", JSON.stringify({ phone: "+972501234567", at: Date.now() - 90_000 }));
    render(<PhoneLogin onUseEmail={() => {}} />);
    expect(await screen.findByText("להיכנס עם מייל במקום")).toBeTruthy();
  });

  it("starts over from the number when the saved state is old or broken", async () => {
    localStorage.setItem("scan-home-otp-pending", JSON.stringify({ phone: "+972501234567", at: Date.now() - 11 * 60_000 }));
    const { unmount } = render(<PhoneLogin />);
    expect(NUMBER_BOX()).toBeTruthy();
    unmount();
    localStorage.setItem("scan-home-otp-pending", "{not json");
    render(<PhoneLogin />);
    expect(NUMBER_BOX()).toBeTruthy();
  });
});
