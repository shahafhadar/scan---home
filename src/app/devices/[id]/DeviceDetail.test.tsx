import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const replace = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace, refresh: vi.fn() }) }));

let device: Record<string, unknown> | null;
let role: string | null;
const rpc = vi.fn();
const updateMock = vi.fn();

const table = () => {
  const chain: Record<string, unknown> = {};
  chain.select = () => chain;
  chain.eq = () => chain;
  chain.maybeSingle = () => Promise.resolve({ data: device, error: null });
  chain.update = (patch: unknown) => {
    updateMock(patch);
    return { eq: () => Promise.resolve({ error: null }) };
  };
  return chain;
};

vi.mock("@/lib/supabase/client", () => ({
  supabaseBrowser: () => ({
    from: () => table(),
    rpc: (name: string) => {
      rpc(name);
      if (name === "my_role_in") return Promise.resolve({ data: role, error: null });
      return Promise.resolve({ data: "cmd-1", error: null });
    },
  }),
}));
const { DeviceDetail } = await import("./DeviceDetail");

beforeEach(() => {
  replace.mockReset();
  rpc.mockReset();
  updateMock.mockReset();
  device = {
    id: "d1",
    serial: "SC-TEST-1",
    name: "מטבח",
    household_id: "h1",
    status: "active",
    firmware_version: "1.0",
    last_seen_at: new Date().toISOString(),
    last_rssi: -50,
    scanner_attached: true,
    safe_mode: false,
  };
  role = "owner";
});
afterEach(() => cleanup());

describe("DeviceDetail", () => {
  it("shows the device and lets an owner rename it", async () => {
    render(<DeviceDetail deviceId="d1" />);
    const input = await screen.findByDisplayValue("מטבח");
    fireEvent.change(input, { target: { value: "סלון" } });
    fireEvent.click(screen.getByRole("button", { name: "שמירה" }));
    await waitFor(() => expect(updateMock).toHaveBeenCalledWith({ name: "סלון" }));
  });

  it("offers factory reset and release only to an owner", async () => {
    render(<DeviceDetail deviceId="d1" />);
    await screen.findByText("מטבח");
    expect(screen.getByText("איפוס לברירת מחדל")).toBeTruthy();
    expect(screen.getByText("הסרת המכשיר מהחשבון")).toBeTruthy();
  });

  it("hides owner-only actions and the rename form from a viewer", async () => {
    role = "viewer";
    render(<DeviceDetail deviceId="d1" />);
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("my_role_in"));
    expect(screen.queryByText("איפוס לברירת מחדל")).toBeNull();
    expect(screen.queryByText("הסרת המכשיר מהחשבון")).toBeNull();
    expect(screen.queryByRole("button", { name: "שמירה" })).toBeNull();
  });

  it("says when a device is not found", async () => {
    device = null;
    render(<DeviceDetail deviceId="missing" />);
    expect(await screen.findByText(/לא נמצא/)).toBeTruthy();
  });
});
