import { describe, expect, it, vi } from "vitest";
import { OAuthPendingStore } from "./oauthPendingStore.js";

describe("OAuthPendingStore", () => {
  it("create returns state and verifier", () => {
    const s = new OAuthPendingStore();
    const { state, codeVerifier } = s.create();
    expect(state.length).toBeGreaterThan(10);
    expect(codeVerifier.length).toBeGreaterThan(10);
  });

  it("consume removes pending row", () => {
    const s = new OAuthPendingStore();
    const { state } = s.create();
    expect(s.consume(state)).toBeDefined();
    expect(s.consume(state)).toBeUndefined();
  });

  it("consume returns undefined for unknown state", () => {
    const s = new OAuthPendingStore();
    expect(s.consume("unknown")).toBeUndefined();
  });

  it("consume returns undefined after TTL", () => {
    vi.useFakeTimers();
    const s = new OAuthPendingStore();
    const { state } = s.create();
    vi.advanceTimersByTime(11 * 60 * 1000);
    expect(s.consume(state)).toBeUndefined();
    vi.useRealTimers();
  });
});
