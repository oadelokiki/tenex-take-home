import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi, afterEach } from "vitest";
import { App } from "./App";

describe("App", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("shows connect when unauthenticated", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: RequestInfo) => {
        const u = typeof url === "string" ? url : url.toString();
        if (u.includes("/api/session")) {
          return {
            ok: true,
            json: async () => ({ authenticated: false }),
          };
        }
        throw new Error(`unexpected fetch: ${u}`);
      }),
    );

    render(<App />);
    expect(await screen.findByRole("link", { name: /Connect Google Calendar/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Calendar Assistant/i })).toBeInTheDocument();
  });
});
