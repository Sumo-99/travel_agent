# Travel Booking Agent — Design Spec

Captured from the grilling session on 2026-09-10. This is the source of truth
the implementation plan (`docs/superpowers/plans/2026-09-10-travel-booking-agent.md`)
argues from.

## Scope

- **US domestic round-trip flights only** for v1 (international is a later phase).
- **Hotels** in the destination city for the same date range.
- **No payments, no booking transactions.** The app searches and compares; the
  end result is a link the user follows to complete the purchase on the
  provider's own site.
- **No user accounts, no persistence beyond one browser session.**
- **Currency: USD only.** No locale/currency selection in v1.

## Delivery Mechanism

Bespoke Next.js web app with its own chat UI — **not** an MCP server plugged
into Claude Desktop/claude.ai. The app's own backend performs LLM
orchestration and calls flight/hotel search functions directly as tools.

## Stack

- **Next.js monolith** (App Router, TypeScript), single deploy target.
- LLM: **OpenRouter**, free tier, model **`nvidia/nemotron-3.5-lightning:free`**
  (chosen over `nex-agi/nex-n2.5-pro:free` because it's vendor-backed/stable
  rather than "free for a limited time"; chosen over
  `poolside/laguna-s-2.1:free` due to that model's training-data-use caveat
  on free-tier traffic). Accessed via the OpenAI-compatible SDK pointed at
  OpenRouter's base URL.
  - Rate limits: 20 req/min; 50 req/day unless the OpenRouter account has
    ever purchased $10+ of credit (lifetime), which raises the cap to
    1,000/day. **Recommend the $10 top-up** — a single multi-turn chat
    session can burn through 50 req/day quickly.
- Flight/hotel data: **Amadeus for Developers** (self-serve signup, free
  test-environment tier), both Flight Offers Search and Hotel Search.

## Known Data Limitation (must be disclosed in the UI)

Amadeus is GDS-based. It will **not** reliably surface:
- Southwest Airlines (does not distribute through GDS/Amadeus at all).
- Other budget carriers that sell primarily direct (e.g. Spirit, Frontier
  coverage can be partial).
- Web-only fares airlines don't file to GDS.

The UI must show a persistent, short disclosure note near results, e.g.:
"Results come from GDS-connected airlines and hotels. Some carriers
(notably Southwest) and web-only fares may not appear here."

## UI Layout

- **Two resizable, side-by-side panels**: a form panel (left) and a chat
  panel (right).
- **Form fields** (all required): Origin (IATA code), Destination (IATA
  code), Departure date, Return date, Number of travelers, Cabin class
  (Economy / Premium Economy / Business / First).
- Hotel-specific preferences (star rating, budget/night, amenities, etc.)
  are **not** in the form — they're expressed via the chat bar, either
  upfront by the user or in response to the agent's clarifying questions.
- Submitting the form converts it into a structured first message sent
  into the **same** agent pipeline the chat bar uses (see Orchestration).
  While the agent is working (on form submit or on any chat message),
  further chat input is **disabled** until the agent's response completes.
  The agent's status and final text both render in the chat panel.
- **Results panel**: a single tabular view with a toggle/tab to switch
  between Flights and Hotels (not two permanently-visible tables).
  Default: top 10 results per category, sorted by price ascending.

## Orchestration Model

Form submission and chat messages both flow through one agent loop:

1. The user's structured form data (or free-text chat message) becomes a
   message to the LLM.
2. The LLM decides whether it has enough information to search, or needs
   to ask a clarifying question (e.g. missing budget/class preference for
   hotels) — clarifying questions are asked as normal chat turns.
3. When ready, the LLM calls tools: `search_flights`, `search_hotels`.
   The model always passes the *full* known criteria on every tool call
   (as if searching from scratch) — the backend transparently decides
   whether to reuse cached results or hit the Amadeus API again (see
   Refinement Logic below). The model does not need to reason about
   caching itself.
4. Results are stored in server-side session state and rendered in the
   results panel; a short natural-language summary streams into chat.

## Refinement Logic (chat follow-ups like "show cheaper options")

1. If the new criteria's *route/date/traveler/cabin* parameters match the
   last search exactly, and the additional constraints (price ceiling,
   stops, star rating, etc.) can be satisfied by filtering the already-
   cached result set, do that — no new Amadeus call.
2. If filtering the cache yields nothing, or the route/date/traveler/cabin
   parameters changed, run a **new** Amadeus search for the (changed)
   criteria, then **merge** the fresh results with the previously cached
   results (deduping by offer ID), **re-rank** the merged set (price
   ascending by default), and apply the requested filters to the merged
   set before returning the top 10.

## Session State

Server-side, **in-memory**, keyed by a session-id cookie. No database, no
cross-restart durability required for v1. Holds: chat message history,
last search parameters, last fetched flight results, last fetched hotel
results.

## Booking Links

No API gives a genuine zero-redirect "buy this exact fare" link without
becoming an accredited travel agency. The approach:

1. Maintain a small hardcoded map of major **US domestic carriers**
   (Delta, United, American, Southwest, JetBlue, Alaska) and a few major
   **hotel chains** (Marriott, Hilton, Hyatt) to hand-built deep-link URL
   templates that pre-fill that provider's own booking-search page with
   route/dates (best-effort; these patterns can break if a provider
   changes their site).
2. When a carrier/chain isn't in the map, fall back to a **constructed
   Google Flights / Google Hotels URL** for that route and date range —
   still shows real, comparable options without funneling through any
   single OTA.
3. Every booking link carries a one-line note in the UI stating whether
   it's a direct provider link or the Google Flights/Hotels fallback, and
   if the latter, a one-liner on why ("Direct link unavailable for
   [Carrier] — showing live Google Flights results instead.").

## Explicitly Out of Scope for v1

- Payments / completing a purchase in-app.
- User accounts, saved trips, trip history.
- Non-US / international flights.
- Multi-city itineraries, one-way-only searches.
- Currency selection (USD fixed).
- A public-facing MCP server.
