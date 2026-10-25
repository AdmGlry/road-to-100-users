import { describe, expect, it } from "vitest";

import { DEFAULT_AFTER_LOGIN_PATH, safeRedirectPath } from "@/lib/auth/safe-redirect";

describe("safeRedirectPath", () => {
  it("keeps same-origin relative paths with query and hash", () => {
    expect(safeRedirectPath("/profile")).toBe("/profile");
    expect(safeRedirectPath("/hunter?search=1#top")).toBe("/hunter?search=1#top");
    expect(safeRedirectPath("/")).toBe("/");
  });

  it("falls back to the default when missing or empty", () => {
    expect(safeRedirectPath(undefined)).toBe(DEFAULT_AFTER_LOGIN_PATH);
    expect(safeRedirectPath(null)).toBe(DEFAULT_AFTER_LOGIN_PATH);
    expect(safeRedirectPath("")).toBe(DEFAULT_AFTER_LOGIN_PATH);
    expect(DEFAULT_AFTER_LOGIN_PATH).toBe("/dashboard");
  });

  it("uses the first value of an array", () => {
    expect(safeRedirectPath(["/tracker", "//evil.com"])).toBe("/tracker");
    expect(safeRedirectPath([])).toBe(DEFAULT_AFTER_LOGIN_PATH);
  });

  it.each([
    "//evil.com",
    "//evil.com/path",
    "/\\evil.com",
    "\\\\evil.com",
    "https://evil.com",
    "http:/evil.com",
    "javascript:alert(1)",
    "evil.com",
    "dashboard",
    "/\t/evil.com",
    "/\n/evil.com",
  ])("rejects unsafe value %j", (value) => {
    expect(safeRedirectPath(value)).toBe(DEFAULT_AFTER_LOGIN_PATH);
  });

  it("normalises dot segments without leaving the origin", () => {
    expect(safeRedirectPath("/a/../settings")).toBe("/settings");
    expect(safeRedirectPath("/../../etc")).toBe("/etc");
  });

  it("honours a custom fallback", () => {
    expect(safeRedirectPath("//evil.com", "/")).toBe("/");
  });
});
