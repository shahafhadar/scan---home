import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn();
vi.mock("@/lib/supabase/client", () => ({ supabaseBrowser: () => ({ rpc }) }));
const { AdoptPanel } = await import("./AdoptPanel");

let candidates: unknown[];
let adoptResult: { ok: boolean; error?: string };

beforeEach(() => {
  candidates = [{ serial: "SC-TEST-ABCD", last4: "ABCD", firmware_version: "test", last_seen_at: null }];
  adoptResult = { ok: true };
  rpc.mockReset().mockImplementation((name: string) => {
    if (name === "list_adoptable_devices") return Promise.resolve({ data: candidates, error: null });
    if (name === "adopt_device") return Promise.resolve({ data: adoptResult, error: null });
    return Promise.resolve({ data: null, error: null });
  });
});
afterEach(() => cleanup());

describe("AdoptPanel", () => {
  it("lists a found scanner and adopts it with one tap", async () => {
    const onAdopted = vi.fn();
    render(<AdoptPanel onAdopted={onAdopted} />);
    const button = await screen.findByRole("button", { name: "זה שלי" });
    fireEvent.click(button);
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("adopt_device", { p_serial: "SC-TEST-ABCD" }));
    await waitFor(() => expect(onAdopted).toHaveBeenCalledWith("SC-TEST-ABCD"));
  });

  it("shows the searching state when nothing is found", async () => {
    candidates = [];
    render(<AdoptPanel />);
    expect(await screen.findByText(/מחפש סורק חדש/)).toBeTruthy();
  });

  it("surfaces a failure to adopt", async () => {
    adoptResult = { ok: false, error: "המכשיר כבר משויך" };
    render(<AdoptPanel />);
    fireEvent.click(await screen.findByRole("button", { name: "זה שלי" }));
    expect(await screen.findByText("המכשיר כבר משויך")).toBeTruthy();
  });
});
