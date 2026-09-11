# Fix: Stream-Abort Misclassification + Empty Completion Crash

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. This plan is small enough for a single sequential worker — no subagent dispatch needed.

**Goal:** Fix two bugs found via live reproduction against the post-SerpApi-migration `main` branch (see debugging session dated 2026-09-11):

1. A dead client connection is misreported as a `search_flights`/`search_hotels` tool failure, which burns additional slow model iterations against a socket nobody is reading, and produces the user-visible symptom "status message appears, then nothing — but the browser shows the request as finished."
2. A provider response with no `choices` array crashes `handleTurn` with an opaque `Cannot read properties of undefined (reading '0')` instead of degrading gracefully.

**Root cause context:** `MODEL = "nvidia/nemotron-3.5-lightning:free"` (`lib/agent/orchestrator.ts`) is slow enough (multi-minute turns observed in live testing) that the underlying connection reliably outlives a browser's patience or an idle-socket timeout somewhere in the stack, exposing both bugs. Model choice is being decided separately and is **out of scope** for this plan — these fixes stand on their own regardless of which model is ultimately chosen, since a dead-connection race and an unvalidated provider response are real bugs independent of latency.

**Tech Stack:** Same Next.js/TypeScript/Vitest stack. No new dependencies.

## Global Constraints

- Do not change `MODEL` or anything model-selection-related in this plan.
- Do not change the `AgentDependencies` interface or `searchFlights`/`searchHotels` signatures.
- Keep both fixes isolated and independently revertable — they touch different files and don't depend on each other.

---

## Task 1: Guard against an empty/malformed completion response

**File:** `lib/agent/orchestrator.ts` (around line 238, inside the `for (let iteration ...)` loop in `handleTurn`, immediately after `const completion = await client.chat.completions.create(...)`)

- [ ] Replace the unchecked `const choice = completion.choices[0];` with a length check on `completion.choices` first.
- [ ] If `completion.choices` is missing or empty: `console.error("[orchestrator] empty completion from provider", completion);` (server-side diagnosability, matching the existing pattern at the tool-catch site a few lines below), then `break` out of the iteration loop.
- [ ] Do not introduce a new return path — falling through to the existing post-loop code (`const assistantText = finalText || "I found some results — check the table for details.";`) already handles `finalText` being `""`, so breaking is sufficient and keeps `handleTurn`'s existing exit contract (always pushes an assistant message, always returns a string).
- [ ] Add a test in `lib/agent/orchestrator.test.ts`: mock the OpenAI client's `chat.completions.create` to resolve with `{ choices: [] }` for one call; assert `handleTurn` resolves (does not throw) and returns the fallback string, and that `session.messages` still gets an assistant entry appended.

## Task 2: Make the response stream abort-safe

**File:** `app/api/chat/route.ts` (the `POST` handler's `ReadableStream` construction, lines ~30-58)

- [ ] Add a `closed` flag in the stream's closure, initialized `false`.
- [ ] Add a `cancel()` handler to the `ReadableStream` init object (sibling to `start()`) that sets `closed = true`. This is the runtime's built-in signal for "the consumer went away" — it fires on client disconnect without needing to inspect `req.signal` manually.
- [ ] Change `emit` to check the flag before enqueuing, and to also defensively catch a possible `enqueue()` throw (the `cancel()` callback and an in-flight `enqueue()` can race) and set `closed = true` in that catch rather than letting the exception propagate:
  ```ts
  let closed = false;
  const emit = (payload: unknown) => {
    if (closed) return;
    try {
      controller.enqueue(encoder.encode(JSON.stringify(payload) + "\n"));
    } catch {
      closed = true;
    }
  };
  ```
- [ ] Guard the `finally` block's `controller.close()` the same way: `if (!closed) controller.close();` — closing an already-closed/errored controller throws `ERR_INVALID_STATE` too.
- [ ] Confirm (do not change) that `orchestrator.ts`'s tool-call `try/catch` is untouched — it should keep catching genuine `search_flights`/`search_hotels` failures exactly as before; this fix only stops a dead pipe from masquerading as one.
- [ ] Add a test: construct the stream, obtain a reader, call `reader.cancel()` (or drop the reader and let GC/runtime invoke `cancel()`, whichever is reliably testable under Vitest + `ReadableStream`), then drive a mocked `orchestrator.handleTurn` that calls `onStatus` twice with an `await` in between — assert no unhandled exception and that the second `onStatus` call is a silent no-op.

## Verification

- [ ] `npm test` passes, including the two new cases above.
- [ ] Manual repro: start `next dev`, fire a request, kill the client mid-turn (e.g. `curl --max-time <shorter than a turn takes>`), confirm the dev server log no longer shows `[orchestrator] tool search_flights failed TypeError: Invalid state: Controller is already closed` — a killed connection should now end quietly.
