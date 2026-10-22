// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { DRIVE_SCOPE, DriveAuth, type GoogleIdentity } from "../src/api/driveAuth";

type TokenAnswer = { access_token?: string; expires_in?: number; scope?: string; error?: string };
function setup(answer: TokenAnswer | { popupError: string }, status = 200) {
  let callback: (response: TokenAnswer) => void = () => {};
  let errorCallback: (response: { type?: string }) => void = () => {};
  const requestAccessToken = vi.fn(() => {
    if ("popupError" in answer) errorCallback({ type: answer.popupError });
    else callback(answer);
  });
  const revoke = vi.fn((_token: string, done: (response: { successful: boolean }) => void) => done({ successful: true }));
  const initTokenClient = vi.fn((config: {
    callback: typeof callback; error_callback: typeof errorCallback;
  }) => {
    callback = config.callback;
    errorCallback = config.error_callback;
    return { callback, error_callback: errorCallback, requestAccessToken };
  });
  const google = { accounts: { oauth2: { initTokenClient, revoke } } } as unknown as GoogleIdentity;
  const fetchMock = vi.fn().mockResolvedValue({ ok: status === 200, status });
  const auth = new DriveAuth("test-client.apps.googleusercontent.com", {
    gis: async () => google, fetch: fetchMock as unknown as typeof fetch, now: () => Date.now(),
  });
  return { auth, fetchMock, initTokenClient, requestAccessToken, revoke };
}
afterEach(() => { vi.useRealTimers(); localStorage.clear(); sessionStorage.clear(); });
it("does not request GIS or Drive when Client ID is absent", async () => {
  const gis = vi.fn(), fetchMock = vi.fn();
  const auth = new DriveAuth("", { gis, fetch: fetchMock as unknown as typeof fetch, now: Date.now });
  await auth.prepare(); await auth.authorize();
  expect(auth.getSnapshot().state).toBe("unconfigured");
  expect(gis).not.toHaveBeenCalled(); expect(fetchMock).not.toHaveBeenCalled();
});
it("requests only drive.file and reports authorized only after Drive API verifies token", async () => {
  const { auth, fetchMock, initTokenClient, requestAccessToken } = setup({
    access_token: "memory-only-test-token", scope: DRIVE_SCOPE, expires_in: 3600,
  });
  await auth.prepare(); await auth.authorize();
  expect(auth.getSnapshot().state).toBe("authorized");
  expect(initTokenClient).toHaveBeenCalledWith(expect.objectContaining({ scope: DRIVE_SCOPE }));
  expect(requestAccessToken).toHaveBeenCalledWith({ prompt: "consent" });
  expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("/drive/v3/files?"),
    expect.objectContaining({ headers: { Authorization: "Bearer memory-only-test-token" } }));
  expect(JSON.stringify(localStorage)).not.toContain("memory-only-test-token");
  expect(JSON.stringify(sessionStorage)).not.toContain("memory-only-test-token");
  auth.revoke();
});
it("reports popup cancellation, denied permission and insufficient scope", async () => {
  const cancelled = setup({ popupError: "popup_closed" });
  await cancelled.auth.prepare(); await cancelled.auth.authorize();
  expect(cancelled.auth.getSnapshot()).toMatchObject({ state: "error", error: expect.stringContaining("已取消") });
  const denied = setup({ error: "access_denied" });
  await denied.auth.prepare(); await denied.auth.authorize();
  expect(denied.auth.getSnapshot()).toMatchObject({ state: "error", error: expect.stringContaining("已拒絕") });
  const wrongScope = setup({ access_token: "test", expires_in: 100, scope: "openid" });
  await wrongScope.auth.prepare(); await wrongScope.auth.authorize();
  expect(wrongScope.auth.getSnapshot().state).toBe("error");
  expect(wrongScope.fetchMock).not.toHaveBeenCalled();
});
it("expires token and requires reauthorization after timer or HTTP 401", async () => {
  vi.useFakeTimers();
  const { auth } = setup({ access_token: "short-token", scope: DRIVE_SCOPE, expires_in: 10 });
  await auth.prepare(); await auth.authorize();
  expect(auth.getSnapshot().state).toBe("authorized");
  vi.advanceTimersByTime(5001);
  expect(auth.getSnapshot()).toMatchObject({ state: "expired", error: expect.stringContaining("過期") });
  const invalid = setup({ access_token: "expired-token", scope: DRIVE_SCOPE, expires_in: 3600 }, 401);
  await invalid.auth.prepare(); await invalid.auth.authorize();
  expect(invalid.auth.getSnapshot().state).toBe("expired");
});
it("clears token on revoke and on Drive API rejection", async () => {
  const { auth, revoke } = setup({ access_token: "test-token", scope: DRIVE_SCOPE, expires_in: 3600 });
  await auth.prepare(); await auth.authorize(); auth.revoke();
  expect(auth.getSnapshot().state).toBe("revoked");
  expect(revoke).toHaveBeenCalledWith("test-token", expect.any(Function));
  const blocked = setup({ access_token: "test-token", scope: DRIVE_SCOPE, expires_in: 3600 }, 403);
  await blocked.auth.prepare(); await blocked.auth.authorize();
  expect(blocked.auth.getSnapshot()).toMatchObject({ state: "error", error: expect.stringContaining("拒絕存取") });
});
