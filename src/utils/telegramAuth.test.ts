import crypto from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { config } from "../config.js";
import { validateInitData } from "./telegramAuth.js";

/**
 * Independently reimplements Telegram's WebApp initData signing (not imported from the SUT)
 * so these tests build fixtures rather than validate the implementation against itself.
 */
function signInitData(botToken: string, fields: Record<string, string>): string {
  const params = new URLSearchParams(fields);
  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");

  const secretKey = crypto.createHmac("sha256", "WebAppData").update(botToken).digest();
  const hash = crypto.createHmac("sha256", secretKey).update(dataCheckString).digest("hex");

  params.set("hash", hash);
  return params.toString();
}

describe("validateInitData", () => {
  // Overridden so this suite behaves identically regardless of whether a real .env is present
  // (e.g. in CI without secrets configured).
  const botToken = "test-bot-token-for-unit-tests";
  beforeAll(() => {
    config.botToken = botToken;
  });

  const user = { id: 42, first_name: "Ada", username: "ada" };

  function freshFields(overrides: Partial<Record<string, string>> = {}) {
    return {
      user: JSON.stringify(user),
      auth_date: String(Math.floor(Date.now() / 1000)),
      ...overrides,
    };
  }

  it("accepts correctly signed, fresh initData", () => {
    const initData = signInitData(botToken, freshFields());
    const result = validateInitData(initData);
    expect(result).not.toBeNull();
    expect(result?.id).toBe(42);
    expect(result?.username).toBe("ada");
  });

  it("rejects initData with a tampered field after signing", () => {
    const initData = signInitData(botToken, freshFields());
    const tampered = initData.replace(
      encodeURIComponent(JSON.stringify(user)),
      encodeURIComponent(JSON.stringify({ ...user, id: 999 }))
    );
    expect(validateInitData(tampered)).toBeNull();
  });

  it("rejects initData with no hash param", () => {
    const params = new URLSearchParams(freshFields());
    expect(validateInitData(params.toString())).toBeNull();
  });

  it("rejects initData signed with a different bot token", () => {
    const initData = signInitData("a-completely-different-token", freshFields());
    expect(validateInitData(initData)).toBeNull();
  });

  it("rejects initData older than 24 hours", () => {
    const staleAuthDate = String(Math.floor(Date.now() / 1000) - 90_000);
    const initData = signInitData(botToken, freshFields({ auth_date: staleAuthDate }));
    expect(validateInitData(initData)).toBeNull();
  });

  it("rejects empty input", () => {
    expect(validateInitData("")).toBeNull();
  });
});
