/** Matches assistant ` ```tenex-event ` … ` ``` ` block (machine-readable create payload). */
const TENEX_EVENT_FENCE = /```tenex-event\s*\n([\s\S]*?)```/;

export type ProposalFieldKey = "summary" | "description" | "start" | "end" | "attendees";

export type TenexEventDraftShape = {
  summary: string;
  description: string;
  start: string;
  end: string;
  /** One attendee per line (commas also accepted when parsing for submit). */
  attendeesText: string;
};

export type TenexEventDraftExtraction = {
  shape: TenexEventDraftShape;
  /** If true, the field passed the same client checks as a fully-valid proposal; keep it read-only. */
  locked: Record<ProposalFieldKey, boolean>;
};

export type ProposalFixState = TenexEventDraftExtraction & {
  /** After a failed server validate, unlock fields the server rejected so the user can edit them. */
  serverUnlock: Record<ProposalFieldKey, boolean>;
};

export function initialProposalFixState(ex: TenexEventDraftExtraction): ProposalFixState {
  return {
    ...ex,
    serverUnlock: {
      summary: false,
      description: false,
      start: false,
      end: false,
      attendees: false,
    },
  };
}

const ROOT_FIELDS: ProposalFieldKey[] = ["summary", "description", "start", "end", "attendees"];

/** Map zod `flatten().fieldErrors` keys (e.g. `attendees.0`) to proposal root fields. */
export function proposalFieldKeysFromZodFieldErrors(
  fieldErrors: Record<string, string[] | undefined> | undefined,
): ProposalFieldKey[] {
  if (!fieldErrors) return [];
  const roots = new Set<ProposalFieldKey>();
  for (const k of Object.keys(fieldErrors)) {
    if (!fieldErrors[k]?.length) continue;
    const root = (k.split(".")[0] ?? k) as ProposalFieldKey;
    if (ROOT_FIELDS.includes(root)) roots.add(root);
  }
  return [...roots];
}

export type TenexEventProposal = {
  summary: string;
  description: string;
  start: string;
  end: string;
  attendees: string[];
};

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

function trimStr(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

/** Split attendee lines for submit (newlines or commas). */
export function parseAttendeesLines(input: string): string[] {
  return input
    .split(/[\n,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function clientSummaryOk(s: string): boolean {
  const t = s.trim();
  return t.length > 0 && t.length <= 500;
}

function clientDescriptionOk(s: string): boolean {
  const t = s.trim();
  return t.length > 0 && t.length <= 8000;
}

function clientStartOk(s: string): boolean {
  const t = s.trim();
  if (!t) return false;
  return !Number.isNaN(Date.parse(t));
}

function clientEndOk(start: string, end: string): boolean {
  const es = end.trim();
  if (!es || Number.isNaN(Date.parse(es))) return false;
  const st = start.trim();
  if (!st || Number.isNaN(Date.parse(st))) return false;
  return new Date(es).getTime() > new Date(st).getTime();
}

function clientAttendeesListOk(emails: string[]): boolean {
  if (emails.length === 0 || emails.length > 50) return false;
  const seen = new Set<string>();
  for (const raw of emails) {
    const a = raw.trim();
    if (!looksLikeEmail(a)) return false;
    const k = a.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
  }
  return true;
}

function attendeesFromFenceValue(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const a of raw) {
    if (typeof a === "string" && a.trim()) out.push(a.trim());
  }
  return out;
}

/** Loose email check; server re-validates with zod. */
function looksLikeEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());
}

/**
 * Extract a validated event proposal from assistant content, if present.
 * Returns null if the fence is missing or JSON is invalid.
 */
export function parseTenexEventProposal(content: string): TenexEventProposal | null {
  const m = content.match(TENEX_EVENT_FENCE);
  if (!m?.[1]) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(m[1].trim());
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const o = parsed as Record<string, unknown>;
  if (!isNonEmptyString(o.summary) || !isNonEmptyString(o.description)) return null;
  if (!isNonEmptyString(o.start) || !isNonEmptyString(o.end)) return null;
  const start = o.start.trim();
  const end = o.end.trim();
  if (Number.isNaN(Date.parse(start)) || Number.isNaN(Date.parse(end))) return null;
  if (new Date(end).getTime() <= new Date(start).getTime()) return null;
  if (!Array.isArray(o.attendees) || o.attendees.length === 0) return null;
  const attendees: string[] = [];
  const seen = new Set<string>();
  for (const a of o.attendees) {
    if (typeof a !== "string" || !looksLikeEmail(a)) return null;
    const key = a.trim().toLowerCase();
    if (seen.has(key)) return null;
    seen.add(key);
    attendees.push(a.trim());
  }
  if (attendees.length > 50) return null;
  return {
    summary: o.summary.trim(),
    description: o.description.trim(),
    start,
    end,
    attendees,
  };
}

/**
 * When a `tenex-event` fence exists but the payload is not fully valid, extract values for the fix form.
 * Returns `null` if there is no fence.
 */
export function extractTenexEventDraft(content: string): TenexEventDraftExtraction | null {
  const m = content.match(TENEX_EVENT_FENCE);
  if (!m?.[1]) return null;

  let o: Record<string, unknown> | null = null;
  try {
    const parsed: unknown = JSON.parse(m[1].trim());
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      o = parsed as Record<string, unknown>;
    }
  } catch {
    o = null;
  }

  const summary = o ? trimStr(o.summary) : "";
  const description = o ? trimStr(o.description) : "";
  const start = o ? trimStr(o.start) : "";
  const end = o ? trimStr(o.end) : "";
  const list = o ? attendeesFromFenceValue(o.attendees) : [];
  const attendeesText = list.join("\n");

  const locked: Record<ProposalFieldKey, boolean> = {
    summary: clientSummaryOk(summary),
    description: clientDescriptionOk(description),
    start: clientStartOk(start),
    end: clientEndOk(start, end),
    attendees: clientAttendeesListOk(list),
  };

  return {
    shape: { summary, description, start, end, attendeesText },
    locked,
  };
}

/**
 * Hide the machine block in chat; keep the conversational confirmation visible.
 * @param parseOk whether the fenced JSON passed `parseTenexEventProposal` (controls the hint text).
 * @param inlineFixForm when true, hint points at the in-chat fix form (invalid fence case).
 */
export function stripTenexEventFenceForDisplay(content: string, parseOk = true, inlineFixForm = false): string {
  if (!TENEX_EVENT_FENCE.test(content)) return content.trim();
  const hint = parseOk
    ? "\n\n_(Use **Create on calendar** or **Dismiss** below, or reply **yes** / **create on calendar** in chat.)_\n"
    : inlineFixForm
      ? "\n\n_(The fenced proposal JSON is incomplete or invalid — use the **form below** to fix it. Fields that already look correct are locked.)_\n"
      : "\n\n_(That `tenex-event` JSON did not validate — ask me to fix it: a real description, ISO start/end with offset, and `attendees` as a JSON array of emails. For “only me”, use your signed-in email from the server context.)_\n";
  return content.replace(TENEX_EVENT_FENCE, hint).trim();
}
