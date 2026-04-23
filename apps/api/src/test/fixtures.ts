import type { AppConfig } from "../lib/config.js";

export function testConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    NODE_ENV: "test",
    PORT: 0,
    HOST: "127.0.0.1",
    GOOGLE_CLIENT_ID: "test-client-id.apps.googleusercontent.com",
    GOOGLE_CLIENT_SECRET: "test-google-client-secret-not-real",
    GOOGLE_REDIRECT_URI: "http://localhost:3000/auth/google/callback",
    PUBLIC_WEB_ORIGIN: "http://localhost:5173",
    SESSION_SECRET: "01234567890123456789012345678901",
    OLLAMA_URL: "http://127.0.0.1:11434",
    OLLAMA_MODEL: "mistral:7b-instruct-v0.3-q4_K_M",
    CALENDAR_MAX_RANGE_DAYS: 32,
    E2E_MODE: false,
    E2E_SECRET: undefined,
    ...overrides,
  };
}
