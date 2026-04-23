import type { FastifyInstance, FastifyRequest } from "fastify";
import type { AppConfig } from "../lib/config.js";
import { sessionCookieOpts } from "../lib/sessionCookie.js";
import { TENEX_SESSION_COOKIE } from "../lib/sessionConstants.js";
import type { AppStores } from "../lib/appStores.js";

function assertE2eSecret(req: FastifyRequest, config: AppConfig): void {
  if (!config.E2E_SECRET) {
    throw Object.assign(new Error("E2E_SECRET missing"), { statusCode: 500 });
  }
  const got = req.headers["x-e2e-secret"];
  if (got !== config.E2E_SECRET) {
    throw Object.assign(new Error("Forbidden"), { statusCode: 403 });
  }
}

/** Automation-only routes; never registered unless `config.E2E_MODE`. */
export function registerE2eRoutes(
  app: FastifyInstance,
  opts: { config: AppConfig; stores: AppStores },
): void {
  const { config, stores } = opts;
  if (!config.E2E_MODE) return;

  app.post("/__e2e/reset", async (req, reply) => {
    try {
      assertE2eSecret(req, config);
    } catch (e: unknown) {
      const code = (e as { statusCode?: number }).statusCode ?? 500;
      return reply.status(code).send({ error: "forbidden" });
    }
    stores.sessions.clear();
    stores.oauthPending.clear();
    return { ok: true };
  });

  app.post("/__e2e/session", async (req, reply) => {
    try {
      assertE2eSecret(req, config);
    } catch (e: unknown) {
      const code = (e as { statusCode?: number }).statusCode ?? 500;
      return reply.status(code).send({ error: "forbidden" });
    }
    const body = (req.body ?? {}) as { email?: string };
    const email = typeof body.email === "string" ? body.email : "e2e-user@example.com";
    const sid = stores.sessions.create({
      googleRefreshToken: "e2e-fake-refresh-token",
      email,
    });
    reply.setCookie(TENEX_SESSION_COOKIE, sid, sessionCookieOpts(config));
    return { ok: true, email };
  });
}
