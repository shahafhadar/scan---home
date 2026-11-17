import { describe, expect, it } from "vitest";
import { formatListSms, lineText, type ListLine } from "./listMessage";

const item = (over: Partial<ListLine> = {}): ListLine => ({
  name: "חלב",
  quantity: 1,
  unit: null,
  identified: true,
  barcode: "7290000066318",
  ...over,
});

describe("lineText", () => {
  it("says only the name for one of something", () => expect(lineText(item())).toBe("• חלב"));
  it("adds how many when there are several", () => expect(lineText(item({ quantity: 3 }))).toBe("• חלב ×3"));
  it("adds the unit", () => expect(lineText(item({ quantity: 2, unit: "ק״ג" }))).toBe("• חלב ×2 ק״ג"));
  it("does not print a barcode nobody has named", () => {
    expect(lineText(item({ name: "ברקוד 7290000066318", identified: false }))).toBe("• מוצר לא מזוהה (…6318)");
  });
  it("keeps a typed name even without a barcode", () => {
    expect(lineText(item({ name: "עגבניות", identified: false, barcode: null }))).toBe("• עגבניות");
  });
});

describe("formatListSms", () => {
  it("has nothing to send for an empty list", () => expect(formatListSms([])).toBeNull());

  it("lists every item under a count", () => {
    expect(formatListSms([item({ quantity: 2 }), item({ name: "לחם" })])).toBe("רשימת הקניות (2):\n• חלב ×2\n• לחם");
  });

  it("stops before it gets long and says how many are left", () => {
    const many = Array.from({ length: 60 }, (_, i) => item({ name: `מוצר מספר ${i + 1}` }));
    const text = formatListSms(many)!;
    expect(text.length).toBeLessThanOrEqual(330);
    expect(text.split("\n").at(-1)).toMatch(/^ועוד \d+ באפליקציה$/);
    const shown = text.split("\n").filter((l) => l.startsWith("•")).length;
    expect(text).toContain(`ועוד ${60 - shown} באפליקציה`);
  });

  it("does not say 'and 0 more' when everything fits", () => {
    expect(formatListSms([item(), item({ name: "לחם" })])).not.toContain("ועוד");
  });
});
