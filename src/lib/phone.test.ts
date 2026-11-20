import { describe, expect, it } from "vitest";
import { codeDigits, formatPhone, normalizeDigits, toE164, toLocal } from "./phone";

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
    "00972501234567",
    "+972 (0)50-123-4567",
    "\u200e050-123-4567\u200f",
    "050\u00a0123\u00a04567",
    "٠٥٠١٢٣٤٥٦٧",
    "۰۵۰۱۲۳۴۵۶۷",
    "  050-123-4567\n",
  ])("accepts %s", (input) => {
    expect(toE164(input)).toBe("+972501234567");
  });

  it.each(["", "abc", "0521234", "05012345678", "031234567", "+14155552671", "0401234567", "050-123-456a", "+9720", "00972", "07212345678", "+972 3 123 4567"])(
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

describe("normalizeDigits and codeDigits", () => {
  it("reads Arabic-Indic and Persian digits as the digits they are", () => {
    expect(normalizeDigits("٠١٢٣٤٥٦٧٨٩")).toBe("0123456789");
    expect(normalizeDigits("۰۱۲۳۴۵۶۷۸۹")).toBe("0123456789");
  });
  it("keeps only the code's digits, however they were pasted", () => {
    expect(codeDigits("123 456")).toBe("123456");
    expect(codeDigits("123-456")).toBe("123456");
    expect(codeDigits("\u200e١٢٣٤٥٦\u200f")).toBe("123456");
    expect(codeDigits("קוד: 654321.")).toBe("654321");
  });
  it("never returns more than the code's length", () => {
    expect(codeDigits("12345678")).toBe("123456");
    expect(codeDigits("")).toBe("");
  });
});
