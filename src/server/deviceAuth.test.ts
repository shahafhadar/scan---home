import { describe, expect, it } from "vitest";
import { json } from "./deviceAuth";

describe("json", () => {
  it("declares the byte length, so the firmware will read the body", async () => {
    const response = json({ name: "ברקוד 7290000066318" }, 201);
    const text = await response.text();
    expect(response.status).toBe(201);
    expect(response.headers.get("content-type")).toBe("application/json");
    expect(response.headers.get("content-length")).toBe(String(Buffer.byteLength(text)));
    expect(JSON.parse(text)).toEqual({ name: "ברקוד 7290000066318" });
  });
});
