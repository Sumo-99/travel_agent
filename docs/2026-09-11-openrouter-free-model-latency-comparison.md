# OpenRouter Free-Model Latency Comparison

**Context:** The orchestrator's current model, `nvidia/nemotron-3.5-lightning:free` (`lib/agent/orchestrator.ts`), is the root cause of multi-minute first-response times (see `docs/superpowers/plans/2026-09-11-stream-abort-and-empty-completion-guards.md` for the downstream bugs this latency exposes). This note records live timing data collected by curling OpenRouter's `/chat/completions` endpoint directly, to inform a model swap. Model selection itself is a separate, ongoing decision — this is reference data, not a recommendation to implement.

**Method:** Single-turn `curl` against `https://openrouter.ai/api/v1/chat/completions` with prompt `"Say hello in exactly 3 words."`, no `tools`/`tool_choice` schema attached. This measures raw round-trip latency only — **not** tool-calling behavior, which the orchestrator actually depends on (`search_flights`/`search_hotels` via `tools: [searchFlightsToolSchema, searchHotelsToolSchema]`).

## Note: `google/gemini-2.0-flash-exp:free` no longer exists

Requested by name but returns `404 No endpoints found`. As of this test, OpenRouter's catalog has **no free-tier Gemini model at all** — the `google/gemini-*` lineup (up to `gemini-3.8-flash` at time of testing) is paid-only now. A Gemini-based fix would mean accepting per-call cost.

## Results

| Model | HTTP | Latency | Notes |
|---|---|---|---|
| `nvidia/nemotron-3.5-lightning:free` (current) | 200 | **193s (3.2 min)** | Confirms the production symptom is not a one-off; this free model is unreliable at any load. |
| `google/gemma-4-31b-it:free` | 429 | n/a | Rate-limited upstream (shared free-tier pool) on this attempt — no latency data; a real risk factor for free tiers under load regardless of which model is chosen. |
| `liquid/lfm-2.5-2.6b:free` | 200 | **6.0s** | Working candidate. |
| `thinkingmachines/inkling:free` | 403 | n/a | Blocked for direct API use — "only available on agentic harnesses" per OpenRouter's error message. Not usable from this app's server-side fetch. |
| `nex-agi/nex-n2.5-mini:free` | 200 | **0.5s** | Fastest working candidate. |
| `inclusionai/ling-3.0-flash-vl:free` | 200 | 2.2s | Reasoning model — burned 167 hidden `reasoning_tokens` answering a trivial 3-word prompt (`usage.completion_tokens_details.reasoning_tokens` in the response). Real tool-calling turns will carry this same reasoning overhead, likely eroding the apparent speed advantage. |

## Open questions before switching

1. ~~Tool-calling support is unverified.~~ **Verified via live app testing on 2026-09-11** (form submit → clarifying question → follow-up, against the real `search_flights`/`search_hotels` schema in `lib/agent/tools.ts`):
   - **`inclusionai/ling-3.0-flash-vl:free`** — calls tools correctly and completes full turns in 12–14s (down from 2–10+ min on `nemotron-3.5-lightning`). Currently the model wired into `lib/agent/orchestrator.ts` (`MODEL` constant).
   - **`nex-agi/nex-n2.5-mini:free`** — **does not reliably call tools at all.** Instead of invoking `search_flights`/`search_hotels`, it returned its intended tool arguments as a raw JSON string inside the assistant's text content (visible to the end user, no actual search performed). Its earlier 0.5s "fast" result was misleading — it was fast because it wasn't doing the work. **Not viable as-is** despite being the fastest in the raw-latency test.
   - `liquid/lfm-2.5-2.6b:free` has not yet been tested against the live tool-calling flow.
2. **Free-tier rate limiting is a systemic risk**, not specific to `gemma-4-31b-it` — any `:free` model can 429 under shared load. Worth deciding whether a paid model (e.g. `google/gemini-2.5-flash-lite` or `google/gemini-3.5-flash-lite`) is preferable for reliability even at small per-call cost.
3. **Current state:** `MODEL` in `lib/agent/orchestrator.ts` is set to `inclusionai/ling-3.0-flash-vl:free` — the best-performing option tested so far, with real JFK→LAX round-trip flight and hotel results confirmed end-to-end.

## Correction: the "dropped `origin` argument" bug was misdiagnosed

An earlier version of this doc attributed a `SerpApi 400 Missing departure_id parameter` error to `ling-3.0-flash-vl` dropping the `origin` tool-call argument. That was wrong, and stated without checking the raw tool-call payload first. Adding temporary logging of `call.function.arguments` showed the model passed `origin: "JFK"` correctly on every call.

**Actual root cause:** a pre-existing bug in `lib/serpapi/flights.ts`, unrelated to model choice. SerpApi's round-trip Google Flights flow requires a two-step request: an initial search (with `departure_id`/`arrival_id`/dates/etc.) returns a `departure_token` per itinerary, and a second request fetches the return leg using that token. The second request was sending `departure_token` alone, but SerpApi rejects that with `400 Missing departure_id parameter` — it expects the original search params resent alongside the token. Fixed by including `departure_id`, `arrival_id`, `outbound_date`, `return_date`, `adults`, `travel_class`, and `type` in the second request too (`lib/serpapi/flights.ts:171-186`). Verified live: JFK→LAX round-trip now returns real priced itineraries end-to-end.

A `missingRequiredArgs` validation guard was still added to `lib/agent/orchestrator.ts` (checks tool-call args against each tool schema's `required` list before hitting SerpApi, feeding a corrective error back to the model instead of a raw provider 400). It's good defense-in-depth for genuinely malformed tool calls, but it was not the fix for this particular symptom — worth keeping in mind that it didn't catch this bug because the arguments were never actually missing.
