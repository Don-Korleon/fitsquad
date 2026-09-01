import { describe, expect, it } from "vitest";
import { generateInviteCode, withTimeout } from "./helpers.js";

describe("generateInviteCode", () => {
  it("generates a 6-character code from the allowed alphabet only", () => {
    // Ambiguous characters (0/O, 1/I) are intentionally excluded so codes are easy to type.
    const allowed = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/;
    for (let i = 0; i < 200; i++) {
      expect(generateInviteCode()).toMatch(allowed);
    }
  });
});

describe("withTimeout", () => {
  it("resolves with the inner value when it settles before the timeout", async () => {
    const result = await withTimeout(Promise.resolve("ok"), 1000, "test");
    expect(result).toBe("ok");
  });

  it("rejects once the timeout elapses", async () => {
    const neverResolves = new Promise<never>(() => {});
    await expect(withTimeout(neverResolves, 20, "slowOp")).rejects.toThrow(/slowOp timed out/);
  });

  it("propagates a rejection from the inner promise", async () => {
    await expect(withTimeout(Promise.reject(new Error("boom")), 1000, "test")).rejects.toThrow(
      "boom"
    );
  });
});
