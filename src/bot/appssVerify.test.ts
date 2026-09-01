import { describe, expect, it } from "vitest";
import { config } from "../config.js";
import { isAppssAdmin, parseAppssStartParam } from "./appssVerify.js";

describe("parseAppssStartParam", () => {
  it("returns null for the bare command payload", () => {
    expect(parseAppssStartParam("appss_verify")).toBeNull();
  });

  it("extracts the code after an underscore-separated payload", () => {
    expect(parseAppssStartParam("appss_verify_ABC123")).toBe("ABC123");
  });

  it("extracts the code after a hyphen-separated payload", () => {
    expect(parseAppssStartParam("appss_verify-ABC123")).toBe("ABC123");
  });

  it("returns null for an unrelated payload", () => {
    expect(parseAppssStartParam("join_XYZ999")).toBeNull();
  });
});

describe("isAppssAdmin", () => {
  it("is false for undefined userId", () => {
    expect(isAppssAdmin(undefined)).toBe(false);
  });

  it("is false when the user is not in the admin list", () => {
    config.adminTelegramIds = new Set([111]);
    expect(isAppssAdmin(222)).toBe(false);
  });

  it("is true when the user is in the admin list", () => {
    config.adminTelegramIds = new Set([111, 222]);
    expect(isAppssAdmin(222)).toBe(true);
  });
});
