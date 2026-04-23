import { format, startOfWeek as sow, endOfWeek, parse as prs, getDay } from "date-fns";
import { enUS } from "date-fns/locale";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import {
  Calendar,
  dateFnsLocalizer,
  type View,
  type SlotInfo,
} from "react-big-calendar";
import "react-big-calendar/lib/css/react-big-calendar.css";
import {
  createCalendarEvent,
  fetchCalendarEvents,
  getSession,
  logout,
  getClientClockPayload,
  postChat,
  validateCalendarEvent,
  type CalendarEvent,
  type ChatMessage,
  type SessionResponse,
} from "./api";
import {
  extractTenexEventDraft,
  initialProposalFixState,
  parseAttendeesLines,
  parseTenexEventProposal,
  proposalFieldKeysFromZodFieldErrors,
  stripTenexEventFenceForDisplay,
  type ProposalFieldKey,
  type ProposalFixState,
  type TenexEventProposal,
} from "./tenexEventProposal";

const localizer = dateFnsLocalizer({
  format,
  parse: prs,
  startOfWeek: (date: Date) => sow(date, { weekStartsOn: 1 }),
  getDay,
  locales: { "en-US": enUS },
});

type RbcEvent = { title: string; start: Date; end: Date; resource?: CalendarEvent };

function toRbcEvents(events: CalendarEvent[]): RbcEvent[] {
  return events.map((e) => ({
    title: e.summary,
    start: new Date(e.start),
    end: new Date(e.end),
    resource: e,
  }));
}

function formatProposalForPanel(p: TenexEventProposal): string {
  return [
    `Title: ${p.summary}`,
    `Description: ${p.description}`,
    `Start: ${p.start}`,
    `End: ${p.end}`,
    `Attendees: ${p.attendees.join(", ")}`,
  ].join("\n");
}

function isFixFieldReadonly(fix: ProposalFixState, key: ProposalFieldKey): boolean {
  return fix.locked[key] && !fix.serverUnlock[key];
}

function firstFieldError(
  fe: Record<string, string[] | undefined> | null | undefined,
  ...keys: string[]
): string {
  if (!fe) return "";
  for (const k of keys) {
    const v = fe[k];
    if (v?.length) return v.join(" ");
  }
  return "";
}

function attendeeErrorsFromFlatten(
  fe: Record<string, string[] | undefined> | null | undefined,
): string {
  if (!fe) return "";
  const parts: string[] = [];
  for (const [k, v] of Object.entries(fe)) {
    if (k.startsWith("attendees") && v?.length) parts.push(...v);
  }
  return parts.join(" ");
}

/** User typed confirmation / cancel instead of using the panel buttons. */
const CHAT_CONFIRM_RE =
  /^(yes|y|create on calendar|create it|confirm|ok|please create|go ahead|do it|schedule it)\.?$/i;
const CHAT_DISMISS_RE = /^(no|nope|dismiss|cancel|nevermind|never mind|abort|stop)\.?$/i;

export function App() {
  const [session, setSession] = useState<SessionResponse | null>(null);
  const [sessionErr, setSessionErr] = useState<string | null>(null);
  const [viewDate, setViewDate] = useState(() => new Date());
  const [calView, setCalView] = useState<View>("week");
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [calLoading, setCalLoading] = useState(false);
  const [calErr, setCalErr] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [chatErr, setChatErr] = useState<string | null>(null);
  const [pendingProposal, setPendingProposal] = useState<TenexEventProposal | null>(null);
  const [proposalErr, setProposalErr] = useState<string | null>(null);
  const [proposalCreating, setProposalCreating] = useState(false);
  const [proposalFix, setProposalFix] = useState<ProposalFixState | null>(null);
  const [proposalValidating, setProposalValidating] = useState(false);
  const [fixValidateErr, setFixValidateErr] = useState<string | null>(null);
  const [fixFieldErrors, setFixFieldErrors] = useState<Record<string, string[] | undefined> | null>(null);

  const lastAssistantIndex = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      if (messages[i]!.role === "assistant") return i;
    }
    return -1;
  }, [messages]);

  const range = useMemo(() => {
    const start = sow(viewDate, { weekStartsOn: 1 });
    const end = endOfWeek(viewDate, { weekStartsOn: 1 });
    return {
      timeMin: start.toISOString(),
      timeMax: end.toISOString(),
      label: `${format(start, "MMM d")} – ${format(end, "MMM d, yyyy")}`,
    };
  }, [viewDate]);

  const refreshSession = useCallback(async () => {
    setSessionErr(null);
    try {
      const s = await getSession();
      setSession(s);
    } catch {
      setSessionErr("Could not load session.");
      setSession({ authenticated: false });
    }
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const auth = params.get("auth");
    const run = () => {
      if (auth === "success" || auth === "error") {
        window.history.replaceState({}, "", window.location.pathname);
      }
      void refreshSession();
    };
    /** After OAuth, defer one frame so the browser has applied Set-Cookie from the prior navigation. */
    if (auth === "success" || auth === "error") {
      requestAnimationFrame(run);
    } else {
      run();
    }
  }, [refreshSession]);

  const loadCalendar = useCallback(async () => {
    if (!session?.authenticated) return;
    setCalLoading(true);
    setCalErr(null);
    try {
      const { events: ev } = await fetchCalendarEvents(range.timeMin, range.timeMax);
      setEvents(ev);
    } catch (e) {
      setCalErr(e instanceof Error ? e.message : "Calendar load failed");
    } finally {
      setCalLoading(false);
    }
  }, [session, range.timeMin, range.timeMax]);

  useEffect(() => {
    void loadCalendar();
  }, [loadCalendar]);

  const rbcEvents = useMemo(() => toRbcEvents(events), [events]);

  const onNavigate = useCallback((d: Date) => setViewDate(d), []);

  const onSelectSlot = useCallback((_slot: SlotInfo) => {
    /* reserved for future “create from slot” */
  }, []);

  const dismissProposal = useCallback(() => {
    setPendingProposal(null);
    setProposalErr(null);
    setProposalFix(null);
    setFixValidateErr(null);
    setFixFieldErrors(null);
  }, []);

  const dismissProposalFix = useCallback(() => {
    setProposalFix(null);
    setFixValidateErr(null);
    setFixFieldErrors(null);
  }, []);

  const updateProposalFixShape = useCallback((patch: Partial<ProposalFixState["shape"]>) => {
    setProposalFix((prev) => (prev ? { ...prev, shape: { ...prev.shape, ...patch } } : null));
  }, []);

  const submitProposalFix = useCallback(async () => {
    if (!proposalFix) return;
    setFixValidateErr(null);
    setFixFieldErrors(null);
    setProposalValidating(true);
    try {
      const attendees = parseAttendeesLines(proposalFix.shape.attendeesText);
      const res = await validateCalendarEvent({
        summary: proposalFix.shape.summary,
        description: proposalFix.shape.description,
        start: proposalFix.shape.start,
        end: proposalFix.shape.end,
        attendees,
      });
      if (res.ok) {
        setPendingProposal({
          summary: res.event.summary,
          description: res.event.description,
          start: res.event.start,
          end: res.event.end,
          attendees: res.event.attendees,
        });
        setProposalFix(null);
        return;
      }
      setFixValidateErr(res.message);
      if (res.details?.fieldErrors) setFixFieldErrors(res.details.fieldErrors);
      const roots = proposalFieldKeysFromZodFieldErrors(res.details?.fieldErrors);
      setProposalFix((prev) => {
        if (!prev) return null;
        const serverUnlock = { ...prev.serverUnlock };
        for (const r of roots) serverUnlock[r] = true;
        return { ...prev, serverUnlock };
      });
    } finally {
      setProposalValidating(false);
    }
  }, [proposalFix]);

  const confirmProposal = useCallback(async () => {
    if (!pendingProposal) return;
    setProposalErr(null);
    setProposalCreating(true);
    try {
      await createCalendarEvent(pendingProposal);
      setPendingProposal(null);
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: "The event was created on your primary calendar (invites sent where applicable).",
        },
      ]);
      void loadCalendar();
    } catch (e) {
      setProposalErr(e instanceof Error ? e.message : "Could not create event");
    } finally {
      setProposalCreating(false);
    }
  }, [pendingProposal, loadCalendar]);

  const sendChat = useCallback(async () => {
    const text = input.trim();
    if (!text || !session?.authenticated) return;

    if (pendingProposal && CHAT_CONFIRM_RE.test(text)) {
      setChatErr(null);
      setProposalErr(null);
      setInput("");
      const userMsg: ChatMessage = { role: "user", content: text };
      setMessages((prev) => [...prev, userMsg]);
      await confirmProposal();
      return;
    }

    if (pendingProposal && CHAT_DISMISS_RE.test(text)) {
      setChatErr(null);
      setProposalErr(null);
      setInput("");
      setMessages((prev) => [...prev, { role: "user", content: text }]);
      dismissProposal();
      return;
    }

    if (proposalFix && CHAT_CONFIRM_RE.test(text)) {
      setChatErr(null);
      setProposalErr(null);
      setInput("");
      setMessages((prev) => [...prev, { role: "user", content: text }]);
      await submitProposalFix();
      return;
    }

    if (proposalFix && CHAT_DISMISS_RE.test(text)) {
      setChatErr(null);
      setProposalErr(null);
      setInput("");
      setMessages((prev) => [...prev, { role: "user", content: text }]);
      dismissProposalFix();
      return;
    }

    setChatErr(null);
    setProposalErr(null);
    setPendingProposal(null);
    setProposalFix(null);
    setFixValidateErr(null);
    setFixFieldErrors(null);
    const userMsg: ChatMessage = { role: "user", content: text };
    const before = messages;
    const withUser = [...before, userMsg];
    setMessages(withUser);
    setInput("");
    setChatLoading(true);
    try {
      const res = await postChat({
        messages: withUser,
        timeMin: range.timeMin,
        timeMax: range.timeMax,
        ...getClientClockPayload(),
      });
      const raw = res.message.content;
      setMessages([...withUser, { role: "assistant", content: raw }]);
      const full = parseTenexEventProposal(raw);
      if (full) {
        setPendingProposal(full);
        setProposalFix(null);
        setFixValidateErr(null);
        setFixFieldErrors(null);
      } else {
        const ex = extractTenexEventDraft(raw);
        if (ex) {
          setProposalFix(initialProposalFixState(ex));
          setPendingProposal(null);
          setFixValidateErr(null);
          setFixFieldErrors(null);
        } else {
          setProposalFix(null);
          setPendingProposal(null);
        }
      }
    } catch (e) {
      setChatErr(e instanceof Error ? e.message : "Chat failed");
      setMessages(before);
    } finally {
      setChatLoading(false);
    }
  }, [
    input,
    messages,
    session,
    range.timeMin,
    range.timeMax,
    pendingProposal,
    proposalFix,
    confirmProposal,
    dismissProposal,
    dismissProposalFix,
    submitProposalFix,
  ]);

  const connectHref = "/auth/google";

  return (
    <div className="app-shell">
      <header className="toolbar">
        <h1>Calendar Assistant</h1>
        {session?.authenticated ? (
          <>
            <span className="muted">{session.email}</span>
            <button type="button" className="btn" onClick={() => void logout().then(refreshSession)}>
              Sign out
            </button>
          </>
        ) : (
          <a className="btn btn-primary" href={connectHref}>
            Connect Google Calendar
          </a>
        )}
      </header>

      {sessionErr ? <div className="banner banner-error">{sessionErr}</div> : null}

      <div className="layout">
        <section className="panel">
          <h2>Calendar · {range.label}</h2>
          {!session?.authenticated ? (
            <p className="muted">Sign in to load your primary calendar for this week range.</p>
          ) : calErr ? (
            <div className="banner banner-error">{calErr}</div>
          ) : null}
          {session?.authenticated ? (
            <>
              <p className="muted" style={{ marginTop: 0 }}>
                {calLoading ? "Loading events…" : `${events.length} events in view`}
              </p>
              <Calendar
                culture="en-US"
                localizer={localizer}
                events={rbcEvents}
                startAccessor="start"
                endAccessor="end"
                style={{ height: 520 }}
                view={calView}
                onView={setCalView}
                date={viewDate}
                onNavigate={onNavigate}
                selectable
                onSelectSlot={onSelectSlot}
              />
            </>
          ) : null}
        </section>

        <aside className="panel">
          <h2>Assistant</h2>
          <details className="help-disclosure">
            <summary>How this app works</summary>
            <div className="help-disclosure-body">
              <p className="help-lead">
                Chat with an assistant that knows your calendar for this week. Replies are plain text. Use the sections
                below for creating, changing, or canceling events.
              </p>
              <details className="help-disclosure-nested">
                <summary>Create a new event</summary>
                <div className="help-nested">
                  <p>
                    Describe the meeting in your own words (who, when, what it&apos;s about). When the assistant asks
                    if you&apos;re sure, use <strong>Create on calendar</strong> or type <strong>yes</strong> or{" "}
                    <strong>create on calendar</strong> in chat.
                  </p>
                  <p>
                    If details are missing or look wrong, a short form appears under the assistant&apos;s message.
                    Fields that already look fine stay locked; fix the rest, then tap <strong>Edit info</strong> to
                    check with the server. When that passes, <strong>Create on calendar</strong> appears. Use{" "}
                    <strong>Dismiss</strong> or type <strong>no</strong> to cancel.
                  </p>
                </div>
              </details>
              <details className="help-disclosure-nested">
                <summary>Update or reschedule an event</summary>
                <div className="help-nested">
                  <p>
                    Your week is shown on the left from Google Calendar. This app doesn&apos;t edit existing events
                    in place—open the event in <strong>Google Calendar</strong> to change the time, location, or
                    description.
                  </p>
                  <p>
                    You can still <strong>ask the assistant</strong> to suggest new times, compare your availability,
                    or draft an email to attendees about a move.
                  </p>
                </div>
              </details>
              <details className="help-disclosure-nested">
                <summary>Delete or cancel an event</summary>
                <div className="help-nested">
                  <p>
                    To remove an event from your calendar, cancel or delete it in <strong>Google Calendar</strong> so
                    your attendees get the right updates.
                  </p>
                  <p>
                    Ask the assistant if you want help wording a cancellation note or choosing what to tell people.
                  </p>
                </div>
              </details>
            </div>
          </details>
          <div className="chat-log" aria-live="polite">
            {messages.length === 0 ? (
              <span className="muted">No messages yet.</span>
            ) : (
              messages.map((m, i) => {
                const parsedAssistant =
                  m.role === "assistant" ? parseTenexEventProposal(m.content) : null;
                const assistantParseOk = parsedAssistant !== null;
                const showFixBelow =
                  proposalFix !== null && m.role === "assistant" && i === lastAssistantIndex;
                const display =
                  m.role === "assistant"
                    ? stripTenexEventFenceForDisplay(
                        m.content,
                        assistantParseOk,
                        !assistantParseOk && showFixBelow,
                      )
                    : m.content;
                return (
                  <div key={`${i}-${m.role}`} className="chat-turn">
                    <div className={`chat-msg ${m.role === "user" ? "chat-msg-user" : "chat-msg-assistant"}`}>
                      <strong>{m.role === "user" ? "You" : "Assistant"}</strong>
                      {`: ${display}`}
                    </div>
                    {showFixBelow && proposalFix ? (
                      <form
                        className="proposal-inline-fix"
                        aria-label="Fix event proposal fields"
                        onSubmit={(e: FormEvent) => {
                          e.preventDefault();
                          void submitProposalFix();
                        }}
                      >
                        {fixValidateErr ? <div className="banner banner-error">{fixValidateErr}</div> : null}
                        <div className="proposal-field-row">
                          <label htmlFor={`fix-summary-${i}`}>Title</label>
                          <input
                            id={`fix-summary-${i}`}
                            type="text"
                            value={proposalFix.shape.summary}
                            readOnly={isFixFieldReadonly(proposalFix, "summary")}
                            className={isFixFieldReadonly(proposalFix, "summary") ? "input-readonly" : undefined}
                            onChange={(e) => updateProposalFixShape({ summary: e.target.value })}
                          />
                          {firstFieldError(fixFieldErrors, "summary") ? (
                            <span className="field-error">{firstFieldError(fixFieldErrors, "summary")}</span>
                          ) : null}
                        </div>
                        <div className="proposal-field-row">
                          <label htmlFor={`fix-desc-${i}`}>Description</label>
                          <textarea
                            id={`fix-desc-${i}`}
                            rows={3}
                            value={proposalFix.shape.description}
                            readOnly={isFixFieldReadonly(proposalFix, "description")}
                            className={isFixFieldReadonly(proposalFix, "description") ? "input-readonly" : undefined}
                            onChange={(e) => updateProposalFixShape({ description: e.target.value })}
                          />
                          {firstFieldError(fixFieldErrors, "description") ? (
                            <span className="field-error">{firstFieldError(fixFieldErrors, "description")}</span>
                          ) : null}
                        </div>
                        <div className="proposal-field-row">
                          <label htmlFor={`fix-start-${i}`}>Start (ISO-8601)</label>
                          <input
                            id={`fix-start-${i}`}
                            type="text"
                            value={proposalFix.shape.start}
                            readOnly={isFixFieldReadonly(proposalFix, "start")}
                            className={isFixFieldReadonly(proposalFix, "start") ? "input-readonly" : undefined}
                            onChange={(e) => updateProposalFixShape({ start: e.target.value })}
                          />
                          {firstFieldError(fixFieldErrors, "start") ? (
                            <span className="field-error">{firstFieldError(fixFieldErrors, "start")}</span>
                          ) : null}
                        </div>
                        <div className="proposal-field-row">
                          <label htmlFor={`fix-end-${i}`}>End (ISO-8601)</label>
                          <input
                            id={`fix-end-${i}`}
                            type="text"
                            value={proposalFix.shape.end}
                            readOnly={isFixFieldReadonly(proposalFix, "end")}
                            className={isFixFieldReadonly(proposalFix, "end") ? "input-readonly" : undefined}
                            onChange={(e) => updateProposalFixShape({ end: e.target.value })}
                          />
                          {firstFieldError(fixFieldErrors, "end") ? (
                            <span className="field-error">{firstFieldError(fixFieldErrors, "end")}</span>
                          ) : null}
                        </div>
                        <div className="proposal-field-row">
                          <label htmlFor={`fix-att-${i}`}>Attendees (one email per line)</label>
                          <textarea
                            id={`fix-att-${i}`}
                            rows={4}
                            value={proposalFix.shape.attendeesText}
                            readOnly={isFixFieldReadonly(proposalFix, "attendees")}
                            className={isFixFieldReadonly(proposalFix, "attendees") ? "input-readonly" : undefined}
                            onChange={(e) => updateProposalFixShape({ attendeesText: e.target.value })}
                          />
                          {attendeeErrorsFromFlatten(fixFieldErrors) ? (
                            <span className="field-error">{attendeeErrorsFromFlatten(fixFieldErrors)}</span>
                          ) : null}
                        </div>
                        <div className="proposal-inline-fix-actions">
                          <button
                            type="submit"
                            className="btn btn-primary"
                            disabled={proposalValidating || proposalCreating}
                          >
                            {proposalValidating ? "Checking…" : "Edit info"}
                          </button>
                          <button
                            type="button"
                            className="btn"
                            disabled={proposalValidating}
                            onClick={() => dismissProposalFix()}
                          >
                            Cancel
                          </button>
                        </div>
                        <p className="muted" style={{ margin: "0.35rem 0 0" }}>
                          Or send <strong>yes</strong> to submit, <strong>no</strong> to cancel.
                        </p>
                      </form>
                    ) : null}
                  </div>
                );
              })
            )}
          </div>

          {pendingProposal ? (
            <div className="proposal-panel" role="region" aria-label="Confirm calendar event">
              <p className="proposal-panel-title">Are you sure you want to create this event?</p>
              <pre className="proposal-panel-body">{formatProposalForPanel(pendingProposal)}</pre>
              {proposalErr ? <div className="banner banner-error">{proposalErr}</div> : null}
              <p className="muted" style={{ margin: "0 0 0.35rem" }}>
                You can also type <strong>yes</strong> or <strong>create on calendar</strong> in chat to confirm, or{" "}
                <strong>no</strong> / <strong>dismiss</strong> to cancel.
              </p>
              <div className="proposal-panel-actions">
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={proposalCreating}
                  onClick={() => void confirmProposal()}
                >
                  {proposalCreating ? "Creating…" : "Create on calendar"}
                </button>
                <button
                  type="button"
                  className="btn"
                  disabled={proposalCreating}
                  onClick={() => dismissProposal()}
                >
                  Dismiss
                </button>
              </div>
            </div>
          ) : null}

          {chatErr ? <div className="banner banner-error">{chatErr}</div> : null}
          <form
            className="chat-form"
            onSubmit={(e) => {
              e.preventDefault();
              void sendChat();
            }}
          >
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={session?.authenticated ? "Ask your calendar…" : "Sign in to chat"}
              disabled={!session?.authenticated || chatLoading || proposalCreating || proposalValidating}
            />
            <button
              type="submit"
              className="btn btn-primary"
              disabled={!session?.authenticated || chatLoading || proposalCreating || proposalValidating}
            >
              Send
            </button>
          </form>
        </aside>
      </div>
    </div>
  );
}
