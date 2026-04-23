import { describe, expect, it } from "vitest";
import { pkceChallengeS256 } from "./pkce.js";

describe("pkceChallengeS256", () => {
  it("produces stable challenge for verifier", () => {
    const v = "dBjftJeZ4CVP-mB92K27uhbUJU1p1I3w";
    expect(pkceChallengeS256(v)).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(pkceChallengeS256(v)).toBe(pkceChallengeS256(v));
  });
});
