import { test, expect } from "@playwright/test";

/**
 * Critical flow: OAuth start issues redirect to Google with PKCE + state (Location inspection).
 * @see docs/HARNESS.md §13 — Flow 03
 */
test.describe("Flow 03 — OAuth start (Google redirect)", () => {
  test("GET /auth/google returns 302 to accounts.google.com with state and code_challenge", async ({
    request,
  }) => {
    const res = await request.get("/auth/google", { maxRedirects: 0 });
    expect([302, 303]).toContain(res.status());
    const loc = res.headers().location ?? "";
    expect(loc).toMatch(/accounts\.google\.com|oauth2\.googleapis\.com/);
    expect(loc).toMatch(/state=/);
    expect(loc).toMatch(/code_challenge=/);
    expect(loc).toMatch(/code_challenge_method=S256/);
  });
});
