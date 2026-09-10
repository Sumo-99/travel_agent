# Travel Booking Agent — Design Spec

Captured from the grilling session on 2026-09-10. This is the source of truth
the implementation plan (`docs/superpowers/plans/2026-09-10-travel-booking-agent.md`)
argues from.

> **Migration note (2026-09-10):** Amadeus for Developers decommissioned its
> self-service portal on 2026-07-17 (existing keys disabled, new registration
> requires an enterprise sales relationship). The data source described below
> has been superseded by SerpApi's Google Flights and Google Hotels engines.
> See `docs/superpowers/plans/2026-09-10-migrate-to-serpapi.md` for the
> migration plan and the updated "Stack" / "Known Data Limitation" / "Booking
> Links" sections below, which reflect the new provider. Everything else in
> this spec (scope, UI layout, orchestration model, refinement logic, session
> state) is unchanged — the migration only swaps the data-source layer
> underneath an unchanged `RawFlightOffer`/`RawHotelOffer` contract.

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
- Flight/hotel data: **SerpApi** (self-serve signup, free tier 250
  searches/month, paid from $25/mo), using the **Google Flights** and
  **Google Hotels** engines. Superseded Amadeus for Developers — see the
  migration note above.

## Known Data Limitation (must be disclosed in the UI)

SerpApi's Google Flights/Hotels engines scrape/aggregate live Google
results rather than a bookable GDS feed, so:
- Prices and availability can lag the airline's/hotel's own live system by
  a few minutes and are **not guaranteed bookable at the shown price**.
- Coverage is broader than the old GDS-based approach (Google Flights
  **does** include Southwest and other carriers that never appeared in
  Amadeus), but an individual result's actual booking link may point to
  an OTA rather than the airline/hotel's own site — handled by the
  Booking Links section below.
- SerpApi's free tier (250 searches/month) is easy to exhaust once the
  refinement-logic cache-miss path (see Refinement Logic) starts firing
  new searches; budget for the $25/mo tier if testing beyond a handful of
  sessions.

The UI must show a persistent, short disclosure note near results, e.g.:
"Results are sourced from Google Flights/Hotels and may not reflect
real-time pricing or availability — confirm details on the booking page
before purchasing."

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
   whether to reuse cached results or hit SerpApi again (see Refinement
   Logic below). The model does not need to reason about caching itself.
4. Results are stored in server-side session state and rendered in the
   results panel; a short natural-language summary streams into chat.

## Refinement Logic (chat follow-ups like "show cheaper options")

1. If the new criteria's *route/date/traveler/cabin* parameters match the
   last search exactly, and the additional constraints (price ceiling,
   stops, star rating, etc.) can be satisfied by filtering the already-
   cached result set, do that — no new Amadeus call.
2. If filtering the cache yields nothing, or the route/date/traveler/cabin
   parameters changed, run a **new** SerpApi search for the (changed)
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
becoming an accredited travel agency. The approach, in priority order:

1. **Prefer the booking link SerpApi itself returns** for a given flight
   (via the Google Flights `booking_token` → booking-options lookup) or
   hotel (`properties[].link`). Mark it direct (`isDirect: true`) when the
   returned provider is the airline/hotel itself, and non-direct
   (`isDirect: false`) when Google's chosen option is an OTA — SerpApi
   surfaces which provider each option is (`book_with` for flights; the
   property `link`'s domain for hotels).
2. If SerpApi returns no usable booking link for an offer, fall back to
   the original hand-built map of major **US domestic carriers** (Delta,
   United, American, Southwest, JetBlue, Alaska) and major **hotel
   chains** (Marriott, Hilton, Hyatt) — best-effort deep-link URL
   templates that pre-fill that provider's own booking-search page with
   route/dates.
3. If neither of the above applies, fall back further to a **constructed
   Google Flights / Google Hotels URL** for that route and date range —
   still shows real, comparable options without funneling through any
   single OTA.
4. Every booking link carries a one-line note in the UI stating whether
   it's a direct provider link or a fallback, and if the latter, a
   one-liner on why (e.g. "Showing the best available booking option
   found for [Carrier] — not necessarily their own site.").

## Explicitly Out of Scope for v1

- Payments / completing a purchase in-app.
- User accounts, saved trips, trip history.
- Non-US / international flights.
- Multi-city itineraries, one-way-only searches.
- Currency selection (USD fixed).
- A public-facing MCP server.
