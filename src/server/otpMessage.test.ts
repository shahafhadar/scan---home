import { describe, expect, it } from "vitest";
import { otpMessage } from "./otpMessage";

describe("otpMessage", () => {
  it("leads with the code and says not to share it", () => {
    const text = otpMessage("123456", undefined);
    expect(text.split("\n")[0]).toContain("123456");
    expect(text).toContain("לא משתפים");
  });

  it("stays short enough for one Hebrew SMS (70 characters) without a site", () => {
    expect(otpMessage("123456", undefined).length).toBeLessThanOrEqual(70);
  });

  it("ends with the domain-bound line when a site is set", () => {
    const lines = otpMessage("123456", "app.example.com").split("\n");
    expect(lines.at(-1)).toBe("@app.example.com #123456");
  });

  it.each(["https://app.example.com/login", "APP.example.com:3000", " app.example.com "])("cleans %s down to the host", (domain) => {
    expect(otpMessage("123456", domain).split("\n").at(-1)).toMatch(/^@app\.example\.com #123456$/);
  });

  it.each(["", "localhost", "not a host", "https://", "a b.com"])("leaves the line out for %j", (domain) => {
    expect(otpMessage("123456", domain)).not.toContain("@");
  });
});
