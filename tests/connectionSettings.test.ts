// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from "vitest";
import {
  connectionSettings,
  CONNECTION_KEY,
} from "../src/api/connectionSettings";
import { STORAGE_KEY } from "../src/api/mockApi";
const url = new URL(
  "/macros/s/TEST_ONLY_NOT_DEPLOYED/exec",
  "https://script.google.com",
).href;
beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});
it("stores only URL separately; remove does not erase Mock records", () => {
  localStorage.setItem(STORAGE_KEY, "existing records");
  connectionSettings.save(url);
  expect(connectionSettings.read()).toBe(url);
  connectionSettings.remove();
  expect(connectionSettings.read()).toBe("");
  expect(localStorage.getItem(STORAGE_KEY)).toBe("existing records");
});
it("rejects invalid URL without changing a saved value", () => {
  connectionSettings.save(url);
  expect(() => connectionSettings.save("https://evil.test")).toThrow();
  expect(localStorage.getItem(CONNECTION_KEY)).toBe(url);
});
it("reports blocked storage instead of silently discarding settings", () => {
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("denied");
  });
  expect(() => connectionSettings.save(url)).toThrow("無法儲存");
});
