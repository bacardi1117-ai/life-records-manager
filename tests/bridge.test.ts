// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AppsScriptBridge,
  BRIDGE_CHANNEL,
  isGoogleBridgeOrigin,
  validateWebAppUrl,
} from "../src/api/appsScriptBridge";
const url = new URL(
  "/macros/s/TEST_ONLY_NOT_DEPLOYED/exec",
  "https://script.google.com",
).href;
const origin = "https://test-script.googleusercontent.com";
let bridge: AppsScriptBridge;
let host: HTMLDivElement;
let peer: Window;
let send: ReturnType<typeof vi.fn>;
function token() {
  return new URL(host.querySelector("iframe")!.src).searchParams.get("token");
}
function emit(
  data: Record<string, unknown>,
  options: { origin?: string; source?: Window | null } = {},
) {
  window.dispatchEvent(
    new MessageEvent("message", {
      data: { channel: BRIDGE_CHANNEL, token: token(), ...data },
      origin: options.origin ?? origin,
      source: options.source === undefined ? peer : options.source,
    }),
  );
}
async function connect() {
  const promise = bridge.connect(url);
  emit({ type: "ready" });
  await promise;
}
beforeEach(() => {
  vi.useFakeTimers();
  host = document.createElement("div");
  document.body.append(host);
  send = vi.fn();
  peer = { postMessage: send } as unknown as Window;
  bridge = new AppsScriptBridge(host, {
    readyTimeoutMs: 100,
    requestTimeoutMs: 200,
  });
});
afterEach(() => {
  bridge.dispose();
  host.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
});
describe("URL and Google origin boundaries", () => {
  it("accepts only HTTPS exec URLs without embedded credentials or query", () => {
    expect(validateWebAppUrl(` ${url} `)).toBe(url);
    for (const bad of [
      url.replace("https:", "http:"),
      url.replace("/exec", "/dev"),
      `${url}?token=old`,
      `${url}#x`,
      url.replace("script.google.com", "script.google.com.evil.test"),
      url.replace("https://", "https://user:password@"),
    ])
      expect(() => validateWebAppUrl(bad)).toThrow();
  });
  it("rejects origin suffix tricks, ports and opaque origins", () => {
    for (const value of [
      origin,
      "https://script.google.com",
      "https://script.googleusercontent.com",
      "https://nested.script.googleusercontent.com",
    ])
      expect(isGoogleBridgeOrigin(value)).toBe(true);
    for (const value of [
      "null",
      `${origin}.evil.test`,
      `${origin}:444`,
      "https://evilscript.googleusercontent.com",
      "https://evil.test",
    ])
      expect(isGoogleBridgeOrigin(value)).toBe(false);
  });
});
describe("bridge lifecycle and message correlation", () => {
  it("requires ready and uses a new token every connection", async () => {
    await expect(bridge.request("getItems")).rejects.toThrow("尚未");
    const connecting = bridge.connect(url);
    const old = token();
    expect(old).toMatch(/^[0-9a-f-]{36}$/);
    expect(host.querySelectorAll("iframe")).toHaveLength(1);
    emit({ type: "ready" });
    await connecting;
    await connect();
    expect(token()).not.toBe(old);
    expect(host.querySelectorAll("iframe")).toHaveLength(1);
  });
  it("pins nested peer and exact targetOrigin; correlates concurrent out-of-order responses", async () => {
    await connect();
    const first = bridge.request("getItem", { item_id: "one" });
    const second = bridge.request("getItem", { item_id: "two" });
    const a = send.mock.calls[0][0];
    const b = send.mock.calls[1][0];
    expect(send.mock.calls[0][1]).toBe(origin);
    expect(a).toMatchObject({
      channel: "life-records-v1",
      token: token(),
      type: "request",
      action: "getItem",
      payload: { item_id: "one" },
    });
    expect(a.id).not.toBe(b.id);
    emit({ type: "response", id: b.id, ok: true, result: "second" });
    emit({ type: "response", id: a.id, ok: true, result: "first" });
    await expect(first).resolves.toBe("first");
    await expect(second).resolves.toBe("second");
  });
  it("ignores wrong token/channel/origin and null sources during handshake", async () => {
    const promise = bridge.connect(url);
    const resolved = vi.fn();
    void promise.then(resolved);
    emit({ type: "ready", token: "wrong" });
    emit({ type: "ready", channel: "wrong" });
    emit({ type: "ready" }, { origin: "https://evil.test" });
    emit({ type: "ready" }, { source: null });
    await Promise.resolve();
    expect(resolved).not.toHaveBeenCalled();
    emit({ type: "ready" });
    await promise;
  });
  it("ignores a second ready and forged/malformed responses", async () => {
    await connect();
    const other = { postMessage: vi.fn() } as unknown as Window;
    emit({ type: "ready" }, { source: other });
    const result = bridge.request("getItems");
    const done = vi.fn();
    void result.then(done);
    const id = send.mock.calls[0][0].id;
    emit({ type: "response", id, ok: true, result: "bad" }, { source: other });
    emit(
      { type: "response", id, ok: true },
      { origin: "https://script.google.com" },
    );
    emit({ type: "response", id, ok: "true" });
    emit({ type: "response", id: "wrong", ok: true });
    emit({ type: "response", id, token: "old", ok: true });
    await Promise.resolve();
    expect(done).not.toHaveBeenCalled();
    emit({ type: "response", id, ok: true, result: [] });
    await expect(result).resolves.toEqual([]);
  });
  it("rejects server errors without treating them as data", async () => {
    await connect();
    const result = bridge.request("getItems");
    const assertion = expect(result).rejects.toThrow("後端 action 對照失敗");
    emit({
      type: "response",
      id: send.mock.calls[0][0].id,
      ok: false,
      error: "後端 action 對照失敗",
    });
    await assertion;
  });
  it("cleans up on ready timeout and rejects pending requests on disconnect", async () => {
    const timeout = expect(bridge.connect(url)).rejects.toThrow(
      "未收到 Bridge ready",
    );
    await vi.advanceTimersByTimeAsync(100);
    await timeout;
    expect(host.children).toHaveLength(0);
    await connect();
    const pending = expect(bridge.request("getItems")).rejects.toThrow("中斷");
    bridge.dispose();
    await pending;
    expect(host.children).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("does not retry timed-out writes", async () => {
    await connect();
    const pending = expect(bridge.request("createItem", {})).rejects.toThrow(
      "寫入可能已完成",
    );
    await vi.advanceTimersByTimeAsync(200);
    await pending;
    expect(send).toHaveBeenCalledTimes(1);
  });
  it("rejects replaced connection and late token responses", async () => {
    const first = expect(bridge.connect(url)).rejects.toThrow("中斷");
    const old = token();
    const next = bridge.connect(url);
    await first;
    emit({ type: "ready", token: old });
    await expect(bridge.request("getItems")).rejects.toThrow("尚未");
    emit({ type: "ready" });
    await next;
  });
  it("cleans up a synchronous postMessage failure", async () => {
    await connect();
    send.mockImplementation(() => {
      throw new Error("closed");
    });
    await expect(bridge.request("getItems")).rejects.toThrow("無法傳送");
    expect(vi.getTimerCount()).toBe(0);
  });
});
