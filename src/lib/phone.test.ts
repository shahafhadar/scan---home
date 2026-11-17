import { describe, expect, it } from "vitest";
import { formatPhone, toE164, toLocal } from "./phone";

describe("toE164", () => {
  it.each([
    "0501234567",
    "050-123-4567",
    "050 123 4567",
    "501234567",
    "+972501234567",
    "+972 50-123-4567",
    "972501234567",
    "(050) 123.4567",
  ])("accepts %s", (input) => {
    expect(toE164(input)).toBe("+972501234567");
  });

  it.each(["", "abc", "0521234", "05012345678", "031234567", "+14155552671", "0401234567", "050-123-456a"])(
    "rejects %s",
    (input) => {
      expect(toE164(input)).toBeNull();
    },
  );
});

describe("toLocal and formatPhone", () => {
  it("gives the local form gateways want", () => {
    expect(toLocal("+972501234567")).toBe("0501234567");
  });
  it("formats for display", () => {
    expect(formatPhone("+972541234567")).toBe("054-123-4567");
  });
});
