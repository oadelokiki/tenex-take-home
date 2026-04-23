import type { APIRequestContext, BrowserContext, Page } from "@playwright/test";

/** Must match `E2E_SECRET` in `.env.e2e` unless overridden in CI. */
export const E2E_SECRET = process.env.E2E_SECRET ?? "playwright-e2e-local-secret";

export async function e2eReset(request: APIRequestContext): Promise<void> {
  const res = await request.post("/__e2e/reset", {
    headers: { "x-e2e-secret": E2E_SECRET },
  });
  if (!res.ok()) {
    throw new Error(`e2e reset failed: ${res.status()} ${await res.text()}`);
  }
}

export async function e2eLogin(
  request: APIRequestContext,
  options: { email?: string } = {},
): Promise<void> {
  await e2eReset(request);
  const res = await request.post("/__e2e/session", {
    headers: {
      "x-e2e-secret": E2E_SECRET,
      "content-type": "application/json",
    },
    data: { email: options.email ?? "e2e-user@example.com" },
  });
  if (!res.ok()) {
    throw new Error(`e2e session failed: ${res.status()} ${await res.text()}`);
  }
}

/** Prime browser storage from E2E session (cookie jar + optional navigation). */
export async function e2eLoginBrowser(
  context: BrowserContext,
  page: Page,
  options: { email?: string } = {},
): Promise<void> {
  const email = options.email ?? "e2e-user@example.com";
  await e2eLogin(context.request, { email });
  await page.goto("/");
  await page.getByText(new RegExp(email.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i")).waitFor({
    state: "visible",
    timeout: 25_000,
  });
}
