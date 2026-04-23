import { describe, expect, it } from "vitest";
import { loadConfig } from "./config.js";

describe("loadConfig", () => {
  it("rejects short SESSION_SECRET", () => {
    expect(() =>
      loadConfig({
        GOOGLE_CLIENT_ID: "a",
        GOOGLE_CLIENT_SECRET: "b",
        GOOGLE_REDIRECT_URI: "http://localhost/cb",
        SESSION_SECRET: "short",
      }),
    ).toThrow(/SESSION_SECRET/);
  });

  it("loads valid minimal env", () => {
    const c = loadConfig({
      NODE_ENV: "test",
      GOOGLE_CLIENT_ID: "id",
      GOOGLE_CLIENT_SECRET: "secret",
      GOOGLE_REDIRECT_URI: "http://localhost:3000/auth/google/callback",
      SESSION_SECRET: "01234567890123456789012345678901",
    });
    expect(c.OLLAMA_URL).toBe("http://127.0.0.1:11434");
    expect(c.CALENDAR_MAX_RANGE_DAYS).toBe(32);
    expect(c.E2E_MODE).toBe(false);
    expect(c.PUBLIC_WEB_ORIGIN).toBe("http://localhost:5173");
  });

  it("rejects E2E_MODE without E2E_SECRET", () => {
    expect(() =>
      loadConfig({
        NODE_ENV: "test",
        GOOGLE_CLIENT_ID: "id",
        GOOGLE_CLIENT_SECRET: "secret",
        GOOGLE_REDIRECT_URI: "http://localhost:3000/auth/google/callback",
        SESSION_SECRET: "01234567890123456789012345678901",
        E2E_MODE: "1",
      }),
    ).toThrow(/E2E_SECRET/);
  });
});
