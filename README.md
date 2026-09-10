# Travel Booking Agent

A Next.js travel search assistant for comparing US domestic round-trip flights and destination hotels. Users can start with a structured trip form, refine results through chat, and follow provider or fallback links to complete a booking on a third-party site.

## What it does

- Searches round-trip domestic flights between US airports.
- Searches hotels for the destination city and travel dates.
- Accepts natural-language follow-ups such as “show cheaper options” or “only nonstop flights.”
- Keeps search state and chat history in memory for the current browser session.
- Sorts and displays up to 10 flight or hotel results at a time.
- Provides best-effort direct carrier/hotel links, with Google Flights/Hotels fallbacks.
- Uses USD throughout.

The app does not process payments, complete bookings, provide user accounts, or support international, one-way, or multi-city itineraries.

## Architecture

The application is a single Next.js App Router project:

1. The form and chat panel both send requests to `POST /api/chat`.
2. The server-side agent uses OpenRouter’s OpenAI-compatible API and tool-calling.
3. Flight and hotel search functions are exposed to the agent as tools.
4. Results are cached per session, allowing refinements to reuse or extend prior searches.
5. The API streams status messages and final results to the browser as newline-delimited JSON.

Key areas:

```text
app/
  api/chat/route.ts       Streaming chat endpoint
  page.tsx                Main two-panel page
components/               Trip form, chat, resizable panels, results table
lib/agent/                Tool schemas and orchestration loop
lib/amadeus/              Current flight/hotel provider integration
lib/links/                Provider and fallback booking-link builders
lib/session/              In-memory session store
lib/chat/                 Client-side streaming response reader
types/travel.ts           Shared domain types
docs/superpowers/         Design specifications and implementation plans
```

## Current data provider status

The checked-in implementation currently calls the Amadeus APIs and expects the following variables:

```bash
AMADEUS_CLIENT_ID=your-client-id
AMADEUS_CLIENT_SECRET=your-client-secret
# Optional; defaults to https://test.api.amadeus.com
AMADEUS_BASE_URL=https://test.api.amadeus.com
OPENROUTER_API_KEY=your-openrouter-key
```

Create `.env.local` in the project root with those values. The Amadeus test endpoint is suitable for development; use the production endpoint and credentials only when you are ready to do so.

The design spec records a later migration from Amadeus to SerpApi because the Amadeus self-service portal was decommissioned. That migration is described in [`docs/superpowers/plans/2026-09-10-migrate-to-serpapi.md`](docs/superpowers/plans/2026-09-10-migrate-to-serpapi.md), but the migration is not yet reflected in the current `lib/amadeus` implementation.

## Getting started

Requirements:

- Node.js with npm
- An OpenRouter API key
- Amadeus API credentials for the current implementation

Install dependencies and start the development server:

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000), enter airport IATA codes such as `JFK` and `LAX`, choose dates and cabin class, and submit the search. Use the chat panel to refine the displayed results.

## Scripts

```bash
npm run dev       # Start the development server
npm run build     # Create a production build
npm run start     # Serve the production build
npm run lint      # Run ESLint
npm test          # Run the Vitest test suite
```

## Search and session behavior

The agent requires the origin, destination, dates, traveler count, and cabin class before searching flights. Hotel preferences such as a price ceiling or minimum star rating can be supplied in chat.

Search results are stored in a server-side in-memory map keyed by an HTTP-only session cookie. A matching refinement is filtered from the cached results when possible. If the route, dates, traveler count, or cabin class change—or if the cache cannot satisfy the refinement—the provider is queried again and the results are merged, deduplicated, sorted by price, and limited to the top 10 for display.

Because the session store is in memory, sessions are lost when the server restarts and are not shared across deployments or instances.

## Booking links and limitations

The app is a search-and-compare tool, not a booking engine. Links are best-effort deep links for supported airlines and hotel chains, or constructed Google Flights/Hotels searches when a direct link cannot be generated. A link may not preserve the exact fare or room displayed in the table.

Prices and availability should always be confirmed on the destination booking site before purchase.

## Further documentation

- [Design specification](docs/superpowers/specs/2026-09-10-travel-booking-agent.md)
- [Original implementation plan](docs/superpowers/plans/2026-09-10-travel-booking-agent.md)
- [Amadeus-to-SerpApi migration plan](docs/superpowers/plans/2026-09-10-migrate-to-serpapi.md)
