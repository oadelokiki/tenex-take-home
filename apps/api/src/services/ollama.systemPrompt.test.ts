import { describe, expect, it } from "vitest";
import { SYSTEM_PROMPT } from "./ollama.js";

describe("SYSTEM_PROMPT calendar create guidance", () => {
  it("requires the exact final confirmation sentence for new events", () => {
    expect(SYSTEM_PROMPT).toContain("Are you sure you want to create this event?");
  });

  it("documents tenex-event fenced JSON for the SPA", () => {
    expect(SYSTEM_PROMPT).toContain("tenex-event");
  });

  it("documents client clock for relative scheduling", () => {
    expect(SYSTEM_PROMPT).toContain("clientClock");
    expect(SYSTEM_PROMPT).toContain("tonight");
  });
});
