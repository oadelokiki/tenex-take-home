import { config as loadDotenv } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildApp } from "./app.js";
import { getE2eMockDeps } from "./e2e/mocks.js";
import { loadConfig } from "./lib/config.js";
import { OAuthPendingStore } from "./lib/oauthPendingStore.js";
import { SessionStore } from "./lib/sessionStore.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
loadDotenv({ path: resolve(__dirname, "../../../.env") });
if (process.env.TENEX_USE_E2E_ENV === "1") {
  loadDotenv({ path: resolve(__dirname, "../../../.env.e2e"), override: true });
}

const config = loadConfig();

if (config.NODE_ENV === "development" && !config.E2E_MODE) {
  const redirectOrigin = new URL(config.GOOGLE_REDIRECT_URI).origin;
  const webOrigin = new URL(config.PUBLIC_WEB_ORIGIN).origin;
  if (redirectOrigin !== webOrigin) {
    throw new Error(
      `Invalid dev OAuth config: GOOGLE_REDIRECT_URI origin (${redirectOrigin}) must equal PUBLIC_WEB_ORIGIN (${webOrigin}).\n` +
        `Set e.g. GOOGLE_REDIRECT_URI=${webOrigin}/auth/google/callback and the same URI in Google Cloud Console (Authorized redirect URIs).\n` +
        `If Google still sends users to :3000, the Console entry or .env was not updated—restart the API after saving .env.`,
    );
  }
}

const stores = {
  sessions: new SessionStore(),
  oauthPending: new OAuthPendingStore(),
};

const deps = config.E2E_MODE ? getE2eMockDeps() : {};
const app = await buildApp(config, stores, deps);

await app.listen({ port: config.PORT, host: config.HOST });
app.log.info(`API listening on http://${config.HOST}:${config.PORT}`);
