import { describe, expect, it, beforeEach } from "vitest";
import { buildApp } from "../app.js";
import type { AppStores } from "../lib/appStores.js";
import { OAuthPendingStore } from "../lib/oauthPendingStore.js";
import { SessionStore } from "../lib/sessionStore.js";
import { getE2eMockDeps } from "./mocks.js";
import { testConfig } from "../test/fixtures.js";

describe("E2E register routes", () => {
  const secret = "unit-test-e2e-secret-ok";
  const config = testConfig({ E2E_MODE: true, E2E_SECRET: secret });
  let stores: AppStores;

  beforeEach(() => {
    stores = {
      sessions: new SessionStore(),
      oauthPending: new OAuthPendingStore(),
    };
  });

  it("rejects __e2e/reset without secret", async () => {
    const app = await buildApp(config, stores, getE2eMockDeps());
    const res = await app.inject({ method: "POST", url: "/__e2e/reset" });
    expect(res.statusCode).toBe(403);
    await app.close();
  });

  it("rejects __e2e/reset with wrong secret", async () => {
    const app = await buildApp(config, stores, getE2eMockDeps());
    const res = await app.inject({
      method: "POST",
      url: "/__e2e/reset",
      headers: { "x-e2e-secret": "wrong-secret-value-here" },
    });
    expect(res.statusCode).toBe(403);
    await app.close();
  });

  it("clears stores on __e2e/reset", async () => {
    const app = await buildApp(config, stores, getE2eMockDeps());
    const sid = stores.sessions.create({ googleRefreshToken: "x", email: "a@b.co" });
    const { state } = stores.oauthPending.create();
    const res = await app.inject({
      method: "POST",
      url: "/__e2e/reset",
      headers: { "x-e2e-secret": secret },
    });
    expect(res.statusCode).toBe(200);
    expect(stores.sessions.get(sid)).toBeUndefined();
    expect(stores.oauthPending.consume(state)).toBeUndefined();
    await app.close();
  });

  it("does not register __e2e when E2E_MODE is false", async () => {
    const app = await buildApp(testConfig(), stores, {});
    const res = await app.inject({
      method: "POST",
      url: "/__e2e/reset",
      headers: { "x-e2e-secret": secret },
    });
    expect(res.statusCode).toBe(404);
    await app.close();
  });
});
