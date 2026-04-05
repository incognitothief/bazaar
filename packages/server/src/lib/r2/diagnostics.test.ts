import { describe, expect, it } from "bun:test";
import { isR2AccessDenied } from "./diagnostics";

describe("isR2AccessDenied", () => {
  it("detects SDK-style name", () => {
    expect(isR2AccessDenied("AccessDenied", "something")).toBe(true);
  });
  it("detects message text", () => {
    expect(isR2AccessDenied("Error", "Access Denied")).toBe(true);
  });
});
