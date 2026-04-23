import { describe, expect, it } from "vitest";
import {
  extractTenexEventDraft,
  parseAttendeesLines,
  parseTenexEventProposal,
  proposalFieldKeysFromZodFieldErrors,
  stripTenexEventFenceForDisplay,
} from "./tenexEventProposal";

describe("parseTenexEventProposal", () => {
  const validJson = `{
  "summary": "Sync",
  "description": "Weekly sync.",
  "start": "2026-05-01T15:00:00.000Z",
  "end": "2026-05-01T16:00:00.000Z",
  "attendees": ["alice@example.com", "bob@example.org"]
}`;

  it("parses a fenced tenex-event block", () => {
    const content = `Are you sure?\n\n\`\`\`tenex-event\n${validJson}\n\`\`\``;
    const p = parseTenexEventProposal(content);
    expect(p).not.toBeNull();
    expect(p!.summary).toBe("Sync");
    expect(p!.attendees).toHaveLength(2);
  });

  it("returns null without fence", () => {
    expect(parseTenexEventProposal("Just chatting.")).toBeNull();
  });

  it("returns null on duplicate attendees", () => {
    const bad = validJson.replace('"bob@example.org"', '"alice@example.com"');
    const content = `\`\`\`tenex-event\n${bad}\n\`\`\``;
    expect(parseTenexEventProposal(content)).toBeNull();
  });

  it("returns null when end is not after start", () => {
    const bad = validJson
      .replace('"2026-05-01T15:00:00.000Z"', '"2026-05-01T18:00:00.000Z"')
      .replace('"2026-05-01T16:00:00.000Z"', '"2026-05-01T16:00:00.000Z"');
    const content = `\`\`\`tenex-event\n${bad}\n\`\`\``;
    expect(parseTenexEventProposal(content)).toBeNull();
  });
});

describe("stripTenexEventFenceForDisplay", () => {
  it("removes fence and adds success hint when parseOk", () => {
    const raw = `Hello\n\`\`\`tenex-event\n{}\n\`\`\``;
    const out = stripTenexEventFenceForDisplay(raw, true);
    expect(out).toContain("Create on calendar");
    expect(out).not.toContain("tenex-event");
  });

  it("adds validation hint when parse failed", () => {
    const raw = `Hi\n\`\`\`tenex-event\n{}\n\`\`\``;
    const out = stripTenexEventFenceForDisplay(raw, false);
    expect(out).toContain("did not validate");
  });

  it("adds inline-fix hint when parse failed and form is shown", () => {
    const raw = `Hi\n\`\`\`tenex-event\n{}\n\`\`\``;
    const out = stripTenexEventFenceForDisplay(raw, false, true);
    expect(out).toContain("form below");
  });
});

describe("extractTenexEventDraft", () => {
  it("returns null without fence", () => {
    expect(extractTenexEventDraft("no fence")).toBeNull();
  });

  it("extracts partial JSON with only valid fields locked", () => {
    const badJson = `{"summary":"Sync","description":"","start":"2026-05-01T15:00:00.000Z","end":"2026-05-01T16:00:00.000Z","attendees":["a@b.com"]}`;
    const content = `Sure.\n\`\`\`tenex-event\n${badJson}\n\`\`\``;
    expect(parseTenexEventProposal(content)).toBeNull();
    const d = extractTenexEventDraft(content);
    expect(d).not.toBeNull();
    expect(d!.shape.summary).toBe("Sync");
    expect(d!.locked.summary).toBe(true);
    expect(d!.locked.description).toBe(false);
    expect(d!.locked.attendees).toBe(true);
  });

  it("handles unparseable fence body", () => {
    const content = `x\n\`\`\`tenex-event\nnot-json\n\`\`\``;
    const d = extractTenexEventDraft(content);
    expect(d!.shape.summary).toBe("");
    expect(d!.locked.summary).toBe(false);
  });
});

describe("parseAttendeesLines", () => {
  it("splits on newlines and commas", () => {
    expect(parseAttendeesLines("a@b.com, c@d.com\nx@y.org")).toEqual(["a@b.com", "c@d.com", "x@y.org"]);
  });
});

describe("proposalFieldKeysFromZodFieldErrors", () => {
  it("maps nested attendee keys to attendees", () => {
    expect(
      proposalFieldKeysFromZodFieldErrors({
        "attendees.1": ["Invalid attendee email"],
        summary: ["Too long"],
      }).sort(),
    ).toEqual(["attendees", "summary"].sort());
  });
});
