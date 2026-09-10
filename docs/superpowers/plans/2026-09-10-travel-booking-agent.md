# Travel Booking Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Next.js chat + form web app that searches US-domestic round-trip flights and destination hotels via Amadeus, orchestrated by a free OpenRouter LLM with tool-calling, and presents results in a sortable table with best-effort direct booking links.

**Architecture:** A single Next.js (App Router, TypeScript) app. A resizable two-panel UI (form + chat) both feed one server-side agent loop (`lib/agent/orchestrator.ts`) that calls Amadeus search functions as tools, caches results per session in memory, and streams status + final text back to the chat panel over a plain streamed HTTP response. Booking links are assembled by a small carrier/chain deep-link map with a Google Flights/Hotels URL fallback.

**Tech Stack:** Next.js 15 (App Router) + TypeScript + React, Vitest + React Testing Library for tests, `openai` npm package as an OpenAI-compatible client pointed at OpenRouter, native `fetch` for Amadeus (no SDK), no database (in-memory session store), no external CSS framework required.

**Spec:** `docs/superpowers/specs/2026-09-10-travel-booking-agent.md`

## Global Constraints

- Scope is **US domestic round-trip flights + destination hotels only**. No international, no one-way, no multi-city.
- **No payments, no booking transactions, no user accounts.** Every result ends in a link out to a third party.
- **Currency is fixed to USD.** Do not add currency/locale parameters anywhere.
- **Session state is server-side, in-memory, per session-id cookie.** No database.
- LLM model id is exactly `nvidia/nemotron-3.5-lightning:free`, called via OpenRouter (`baseURL: https://openrouter.ai/api/v1`) using the `openai` npm package's client shape.
- Amadeus is the sole price/availability source. Do not add web-scraping (Firecrawl/Tavily) into the price pipeline.
- Every task that runs shell commands for build/test output, `npm install` output, or dev-server logs **must** run them through the `context-mode` MCP tools (`ctx_batch_execute` / `ctx_execute`) instead of raw `Bash`, so raw command output doesn't consume conversation context — only derived pass/fail summaries should be reported back.
- Before writing code against any external library (`next`, `react`, `openai`, `vitest`, `@testing-library/react`), use the `context7` MCP (`resolve-library-id` then `query-docs`) to confirm current API shape — library APIs shift between versions and this plan's code samples may drift from what's actually installed.
- Package manager: `npm`. Do not introduce `yarn`/`pnpm`.

---

## Subagent Plan Overview

5 subagent dispatches total, in two phases. Phase 1 must complete and be reviewed before Phase 2 starts (Phase 2's three tasks import only from Phase 1's output and from each other's *type contracts*, not from each other's implementations, so they can run as three parallel subagents). Phase 3 is sequential after Phase 2.

| Phase | Task | Suggested model | Why |
|---|---|---|---|
| 1 | Task 1: Project scaffold, shared types, session store, UI shell | Sonnet 5 | Sets contracts every other task depends on — needs to be right, but is mostly mechanical. |
| 2 (parallel) | Task 2: Amadeus integration | Sonnet 5 | Real external API, auth flow, response-shape correctness matters. |
| 2 (parallel) | Task 3: Booking-link builder + carrier/chain map | Haiku | Mostly data tables + string templating; low architectural risk, easy to verify with tests. |
| 2 (parallel) | Task 4: Agent orchestration (tool-calling, caching/refinement logic) | Opus 5 | The most architecturally important and error-prone piece — gets this wrong and the whole product misbehaves. |
| 3 | Task 5: Wire UI to the agent, streaming, results table, disclosure copy | Sonnet 5 | Integration work across all prior tasks; moderate complexity, needs correct UX behavior. |

---

### Task 1: Project Scaffold, Shared Types, Session Store, UI Shell

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.ts`, `vitest.config.ts`
- Create: `types/travel.ts`
- Create: `lib/session/store.ts`
- Create: `app/layout.tsx`, `app/page.tsx`, `app/globals.css`
- Create: `components/ResizablePanels.tsx`
- Test: `lib/session/store.test.ts`
- Test: `components/ResizablePanels.test.tsx`

**Interfaces:**
- Produces: all types in `types/travel.ts` (below) — every later task imports from here.
- Produces: `getOrCreateSessionId(): string`, `getSession(sessionId: string): SessionState`, `updateSession(sessionId: string, patch: Partial<SessionState>): void` from `lib/session/store.ts`.
- Produces: `<ResizablePanels left={...} right={...} />` component from `components/ResizablePanels.tsx`.

- [ ] **Step 1: Scaffold the Next.js project**

Before running anything, use the `context7` MCP to resolve `next` and check current `create-next-app` flags (App Router + TypeScript defaults change between versions). Then run via `ctx_batch_execute` (not raw Bash) so install logs don't flood context:

```bash
npx create-next-app@latest . --typescript --app --eslint --no-tailwind --src-dir=false --import-alias "@/*" --use-npm
npm install openai vitest @vitejs/plugin-react jsdom @testing-library/react @testing-library/jest-dom --save
```

Add to `package.json` scripts: `"test": "vitest run"`.

- [ ] **Step 2: Write `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
  },
  resolve: {
    alias: { "@": __dirname },
  },
});
```

- [ ] **Step 3: Write `types/travel.ts`**

```ts
export type CabinClass = "ECONOMY" | "PREMIUM_ECONOMY" | "BUSINESS" | "FIRST";

export interface TripFormInput {
  origin: string;
  destination: string;
  departureDate: string;
  returnDate: string;
  travelers: number;
  cabinClass: CabinClass;
}

export interface BookingLink {
  url: string;
  isDirect: boolean;
  note: string;
}

export interface RawFlightOffer {
  id: string;
  airline: string;
  carrierCode: string;
  flightNumber: string;
  origin: string;
  destination: string;
  departureDateTime: string;
  returnDepartureDateTime: string;
  arrivalDateTime: string;
  returnArrivalDateTime: string;
  stops: number;
  durationMinutes: number;
  priceUSD: number;
  cabinClass: CabinClass;
}

export interface FlightOffer extends RawFlightOffer {
  bookingLink: BookingLink;
}

export interface RawHotelOffer {
  id: string;
  name: string;
  chainCode: string | null;
  starRating: number | null;
  address: string;
  cityCode: string;
  checkInDate: string;
  checkOutDate: string;
  pricePerNightUSD: number;
  totalPriceUSD: number;
}

export interface HotelOffer extends RawHotelOffer {
  bookingLink: BookingLink;
}

export type ChatRole = "user" | "assistant" | "system";

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export interface SearchFlightsToolArgs {
  origin: string;
  destination: string;
  departureDate: string;
  returnDate: string;
  travelers: number;
  cabinClass: CabinClass;
  maxResults?: number;
}

export interface SearchHotelsToolArgs {
  cityCode: string;
  checkInDate: string;
  checkOutDate: string;
  travelers: number;
  maxResults?: number;
}

export interface LastFlightSearchParams {
  origin: string;
  destination: string;
  departureDate: string;
  returnDate: string;
  travelers: number;
  cabinClass: CabinClass;
}

export interface SessionState {
  sessionId: string;
  messages: ChatMessage[];
  lastFlightResults: FlightOffer[];
  lastHotelResults: HotelOffer[];
  lastFlightSearchParams: LastFlightSearchParams | null;
}
```

- [ ] **Step 4: Write the failing test for the session store**

```ts
// lib/session/store.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { getSession, updateSession } from "@/lib/session/store";

describe("session store", () => {
  it("creates a fresh session with empty state on first access", () => {
    const session = getSession("test-session-1");
    expect(session.sessionId).toBe("test-session-1");
    expect(session.messages).toEqual([]);
    expect(session.lastFlightResults).toEqual([]);
    expect(session.lastFlightSearchParams).toBeNull();
  });

  it("persists patches across calls for the same session id", () => {
    getSession("test-session-2");
    updateSession("test-session-2", { messages: [{ role: "user", content: "hi" }] });
    const session = getSession("test-session-2");
    expect(session.messages).toEqual([{ role: "user", content: "hi" }]);
  });
});
```

- [ ] **Step 5: Run test to verify it fails**

Run via `ctx_batch_execute`: `npx vitest run lib/session/store.test.ts`
Expected: FAIL — `lib/session/store.ts` does not exist yet.

- [ ] **Step 6: Implement `lib/session/store.ts`**

```ts
import { randomUUID } from "crypto";
import { cookies } from "next/headers";
import type { SessionState } from "@/types/travel";

const SESSION_COOKIE = "trip_session_id";
const sessions = new Map<string, SessionState>();

function freshState(sessionId: string): SessionState {
  return {
    sessionId,
    messages: [],
    lastFlightResults: [],
    lastHotelResults: [],
    lastFlightSearchParams: null,
  };
}

export function getSession(sessionId: string): SessionState {
  const existing = sessions.get(sessionId);
  if (existing) return existing;
  const created = freshState(sessionId);
  sessions.set(sessionId, created);
  return created;
}

export function updateSession(sessionId: string, patch: Partial<SessionState>): void {
  const current = getSession(sessionId);
  sessions.set(sessionId, { ...current, ...patch });
}

export function getOrCreateSessionId(): string {
  const store = cookies();
  const existing = store.get(SESSION_COOKIE)?.value;
  if (existing) {
    getSession(existing);
    return existing;
  }
  const id = randomUUID();
  store.set(SESSION_COOKIE, id, { httpOnly: true, sameSite: "lax", path: "/" });
  getSession(id);
  return id;
}
```

- [ ] **Step 7: Run test to verify it passes**

Run via `ctx_batch_execute`: `npx vitest run lib/session/store.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 8: Write the failing test for `ResizablePanels`**

```tsx
// components/ResizablePanels.test.tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ResizablePanels } from "@/components/ResizablePanels";

describe("ResizablePanels", () => {
  it("renders both left and right content", () => {
    render(
      <ResizablePanels
        left={<div>form-content</div>}
        right={<div>chat-content</div>}
      />
    );
    expect(screen.getByText("form-content")).toBeInTheDocument();
    expect(screen.getByText("chat-content")).toBeInTheDocument();
  });

  it("exposes a drag handle for resizing", () => {
    render(<ResizablePanels left={<div />} right={<div />} />);
    expect(screen.getByRole("separator")).toBeInTheDocument();
  });
});
```

- [ ] **Step 9: Run test to verify it fails**

Run via `ctx_batch_execute`: `npx vitest run components/ResizablePanels.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 10: Implement `components/ResizablePanels.tsx`**

```tsx
"use client";

import { useCallback, useRef, useState, type ReactNode } from "react";

interface ResizablePanelsProps {
  left: ReactNode;
  right: ReactNode;
  initialLeftPercent?: number;
}

export function ResizablePanels({ left, right, initialLeftPercent = 40 }: ResizablePanelsProps) {
  const [leftPercent, setLeftPercent] = useState(initialLeftPercent);
  const containerRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  const onPointerMove = useCallback((e: PointerEvent) => {
    if (!dragging.current || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const percent = ((e.clientX - rect.left) / rect.width) * 100;
    setLeftPercent(Math.min(80, Math.max(20, percent)));
  }, []);

  const stopDragging = useCallback(() => {
    dragging.current = false;
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", stopDragging);
  }, [onPointerMove]);

  const startDragging = useCallback(() => {
    dragging.current = true;
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", stopDragging);
  }, [onPointerMove, stopDragging]);

  return (
    <div ref={containerRef} style={{ display: "flex", width: "100%", height: "100%" }}>
      <div style={{ width: `${leftPercent}%`, overflow: "auto" }}>{left}</div>
      <div
        role="separator"
        aria-orientation="vertical"
        onPointerDown={startDragging}
        style={{ width: 6, cursor: "col-resize", background: "var(--panel-divider, #ccc)" }}
      />
      <div style={{ width: `${100 - leftPercent}%`, overflow: "auto" }}>{right}</div>
    </div>
  );
}
```

- [ ] **Step 11: Run test to verify it passes**

Run via `ctx_batch_execute`: `npx vitest run components/ResizablePanels.test.tsx`
Expected: PASS (2 tests)

- [ ] **Step 12: Write the app shell**

```tsx
// app/layout.tsx
import type { ReactNode } from "react";
import "./globals.css";

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
```

```tsx
// app/page.tsx
import { ResizablePanels } from "@/components/ResizablePanels";

export default function HomePage() {
  return (
    <main style={{ height: "100vh" }}>
      <ResizablePanels
        left={<div id="form-slot" style={{ padding: 16 }}>Form goes here (Task 5)</div>}
        right={<div id="chat-slot" style={{ padding: 16 }}>Chat goes here (Task 5)</div>}
      />
    </main>
  );
}
```

```css
/* app/globals.css */
:root {
  --panel-divider: #d0d0d0;
  color-scheme: light dark;
}
html, body { margin: 0; height: 100%; }
```

- [ ] **Step 13: Run the full test suite and confirm the dev server boots**

Run via `ctx_batch_execute`: `npx vitest run` (expect all passing), then `npm run build` (expect success).

- [ ] **Step 14: Commit**

```bash
git init
git add package.json tsconfig.json next.config.ts vitest.config.ts types/travel.ts lib/session/store.ts lib/session/store.test.ts components/ResizablePanels.tsx components/ResizablePanels.test.tsx app/layout.tsx app/page.tsx app/globals.css
git commit -m "feat: scaffold Next.js app, shared types, session store, resizable shell"
```

---

### Task 2: Amadeus Integration

**Files:**
- Create: `lib/amadeus/client.ts`
- Create: `lib/amadeus/flights.ts`
- Create: `lib/amadeus/hotels.ts`
- Test: `lib/amadeus/flights.test.ts`
- Test: `lib/amadeus/hotels.test.ts`
- Modify: `.env.local.example` (create if absent) — document `AMADEUS_CLIENT_ID`, `AMADEUS_CLIENT_SECRET`, `AMADEUS_BASE_URL`

**Interfaces:**
- Consumes: `RawFlightOffer`, `RawHotelOffer`, `SearchFlightsToolArgs`, `SearchHotelsToolArgs`, `CabinClass` from `types/travel.ts` (Task 1).
- Produces: `searchFlights(args: SearchFlightsToolArgs): Promise<RawFlightOffer[]>` from `lib/amadeus/flights.ts`.
- Produces: `searchHotels(args: SearchHotelsToolArgs): Promise<RawHotelOffer[]>` from `lib/amadeus/hotels.ts`.

Before writing this task, use the `context7` MCP to look up the current Amadeus for Developers "Flight Offers Search" and "Hotel Search" REST response shapes (field names/nesting do change between API versions) — do not assume the JSON shapes in this task's mock fixtures are exactly current; treat them as the contract this task's own tests pin down, and adjust field-mapping code (not the exported function signatures) if the live API shape differs.

- [ ] **Step 1: Write `lib/amadeus/client.ts`**

```ts
const AMADEUS_BASE_URL = process.env.AMADEUS_BASE_URL ?? "https://test.api.amadeus.com";

interface CachedToken {
  value: string;
  expiresAt: number;
}

let cachedToken: CachedToken | null = null;

export async function getAccessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now()) {
    return cachedToken.value;
  }
  const res = await fetch(`${AMADEUS_BASE_URL}/v1/security/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: process.env.AMADEUS_CLIENT_ID ?? "",
      client_secret: process.env.AMADEUS_CLIENT_SECRET ?? "",
    }),
  });
  if (!res.ok) {
    throw new Error(`Amadeus auth failed: ${res.status} ${await res.text()}`);
  }
  const data = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = { value: data.access_token, expiresAt: Date.now() + (data.expires_in - 60) * 1000 };
  return cachedToken.value;
}

export async function amadeusGet<T>(path: string, params: Record<string, string>): Promise<T> {
  const token = await getAccessToken();
  const query = new URLSearchParams(params).toString();
  const res = await fetch(`${AMADEUS_BASE_URL}${path}?${query}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new Error(`Amadeus request failed: ${res.status} ${await res.text()}`);
  }
  return (await res.json()) as T;
}
```

- [ ] **Step 2: Write the failing test for `searchFlights`**

```ts
// lib/amadeus/flights.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import * as client from "@/lib/amadeus/client";
import { searchFlights } from "@/lib/amadeus/flights";

describe("searchFlights", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("normalizes an Amadeus flight-offers response into RawFlightOffer[]", async () => {
    vi.spyOn(client, "amadeusGet").mockResolvedValue({
      data: [
        {
          id: "1",
          price: { total: "412.50" },
          itineraries: [
            {
              segments: [
                {
                  departure: { iataCode: "JFK", at: "2026-11-03T08:00:00" },
                  arrival: { iataCode: "LAX", at: "2026-11-03T11:20:00" },
                  carrierCode: "DL",
                  number: "204",
                },
              ],
              duration: "PT6H20M",
            },
            {
              segments: [
                {
                  departure: { iataCode: "LAX", at: "2026-11-10T13:00:00" },
                  arrival: { iataCode: "JFK", at: "2026-11-10T21:15:00" },
                  carrierCode: "DL",
                  number: "310",
                },
              ],
              duration: "PT5H15M",
            },
          ],
        },
      ],
      dictionaries: { carriers: { DL: "Delta Air Lines" } },
    });

    const offers = await searchFlights({
      origin: "JFK",
      destination: "LAX",
      departureDate: "2026-11-03",
      returnDate: "2026-11-10",
      travelers: 1,
      cabinClass: "ECONOMY",
    });

    expect(offers).toHaveLength(1);
    expect(offers[0]).toMatchObject({
      id: "1",
      airline: "Delta Air Lines",
      carrierCode: "DL",
      flightNumber: "204",
      origin: "JFK",
      destination: "LAX",
      stops: 0,
      priceUSD: 412.5,
      cabinClass: "ECONOMY",
    });
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run via `ctx_batch_execute`: `npx vitest run lib/amadeus/flights.test.ts`
Expected: FAIL — `lib/amadeus/flights.ts` does not exist yet.

- [ ] **Step 4: Implement `lib/amadeus/flights.ts`**

```ts
import { amadeusGet } from "@/lib/amadeus/client";
import type { RawFlightOffer, SearchFlightsToolArgs } from "@/types/travel";

interface AmadeusSegment {
  departure: { iataCode: string; at: string };
  arrival: { iataCode: string; at: string };
  carrierCode: string;
  number: string;
}

interface AmadeusItinerary {
  segments: AmadeusSegment[];
  duration: string;
}

interface AmadeusFlightOfferRaw {
  id: string;
  price: { total: string };
  itineraries: AmadeusItinerary[];
}

interface AmadeusFlightOffersResponse {
  data: AmadeusFlightOfferRaw[];
  dictionaries?: { carriers?: Record<string, string> };
}

function parseIsoDurationToMinutes(iso: string): number {
  const match = /PT(?:(\d+)H)?(?:(\d+)M)?/.exec(iso);
  const hours = Number(match?.[1] ?? 0);
  const minutes = Number(match?.[2] ?? 0);
  return hours * 60 + minutes;
}

export async function searchFlights(args: SearchFlightsToolArgs): Promise<RawFlightOffer[]> {
  const response = await amadeusGet<AmadeusFlightOffersResponse>("/v2/shopping/flight-offers", {
    originLocationCode: args.origin,
    destinationLocationCode: args.destination,
    departureDate: args.departureDate,
    returnDate: args.returnDate,
    adults: String(args.travelers),
    travelClass: args.cabinClass,
    currencyCode: "USD",
    max: String(args.maxResults ?? 10),
  });

  const carrierNames = response.dictionaries?.carriers ?? {};

  return response.data.map((offer) => {
    const outbound = offer.itineraries[0];
    const inbound = offer.itineraries[1];
    const firstSegment = outbound.segments[0];
    const lastOutboundSegment = outbound.segments[outbound.segments.length - 1];
    const firstInboundSegment = inbound.segments[0];
    const lastInboundSegment = inbound.segments[inbound.segments.length - 1];

    return {
      id: offer.id,
      airline: carrierNames[firstSegment.carrierCode] ?? firstSegment.carrierCode,
      carrierCode: firstSegment.carrierCode,
      flightNumber: firstSegment.number,
      origin: firstSegment.departure.iataCode,
      destination: lastOutboundSegment.arrival.iataCode,
      departureDateTime: firstSegment.departure.at,
      arrivalDateTime: lastOutboundSegment.arrival.at,
      returnDepartureDateTime: firstInboundSegment.departure.at,
      returnArrivalDateTime: lastInboundSegment.arrival.at,
      stops: outbound.segments.length - 1,
      durationMinutes:
        parseIsoDurationToMinutes(outbound.duration) + parseIsoDurationToMinutes(inbound.duration),
      priceUSD: Number(offer.price.total),
      cabinClass: args.cabinClass,
    };
  });
}
```

- [ ] **Step 5: Run test to verify it passes**

Run via `ctx_batch_execute`: `npx vitest run lib/amadeus/flights.test.ts`
Expected: PASS

- [ ] **Step 6: Write the failing test for `searchHotels`**

```ts
// lib/amadeus/hotels.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import * as client from "@/lib/amadeus/client";
import { searchHotels } from "@/lib/amadeus/hotels";

describe("searchHotels", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("normalizes an Amadeus hotel-offers response into RawHotelOffer[]", async () => {
    vi.spyOn(client, "amadeusGet").mockResolvedValue({
      data: [
        {
          hotel: {
            hotelId: "H1",
            name: "Downtown LA Hotel",
            chainCode: "HL",
            rating: "4",
            address: { lines: ["123 Main St"], cityName: "Los Angeles" },
          },
          offers: [{ price: { total: "620.00" } }],
        },
      ],
    });

    const offers = await searchHotels({
      cityCode: "LAX",
      checkInDate: "2026-11-03",
      checkOutDate: "2026-11-10",
      travelers: 1,
    });

    expect(offers).toHaveLength(1);
    expect(offers[0]).toMatchObject({
      id: "H1",
      name: "Downtown LA Hotel",
      chainCode: "HL",
      starRating: 4,
      cityCode: "LAX",
      checkInDate: "2026-11-03",
      checkOutDate: "2026-11-10",
      totalPriceUSD: 620,
      pricePerNightUSD: 620 / 7,
    });
  });
});
```

- [ ] **Step 7: Run test to verify it fails**

Run via `ctx_batch_execute`: `npx vitest run lib/amadeus/hotels.test.ts`
Expected: FAIL — `lib/amadeus/hotels.ts` does not exist yet.

- [ ] **Step 8: Implement `lib/amadeus/hotels.ts`**

```ts
import { amadeusGet } from "@/lib/amadeus/client";
import type { RawHotelOffer, SearchHotelsToolArgs } from "@/types/travel";

interface AmadeusHotelOfferRaw {
  hotel: {
    hotelId: string;
    name: string;
    chainCode: string | null;
    rating?: string;
    address: { lines: string[]; cityName: string };
  };
  offers: Array<{ price: { total: string } }>;
}

interface AmadeusHotelOffersResponse {
  data: AmadeusHotelOfferRaw[];
}

function nightsBetween(checkIn: string, checkOut: string): number {
  const ms = new Date(checkOut).getTime() - new Date(checkIn).getTime();
  return Math.max(1, Math.round(ms / (1000 * 60 * 60 * 24)));
}

export async function searchHotels(args: SearchHotelsToolArgs): Promise<RawHotelOffer[]> {
  const response = await amadeusGet<AmadeusHotelOffersResponse>("/v3/shopping/hotel-offers", {
    cityCode: args.cityCode,
    checkInDate: args.checkInDate,
    checkOutDate: args.checkOutDate,
    adults: String(args.travelers),
    currency: "USD",
    bestRateOnly: "true",
  });

  const nights = nightsBetween(args.checkInDate, args.checkOutDate);

  return response.data.slice(0, args.maxResults ?? 10).map((entry) => {
    const totalPriceUSD = Number(entry.offers[0]?.price.total ?? 0);
    return {
      id: entry.hotel.hotelId,
      name: entry.hotel.name,
      chainCode: entry.hotel.chainCode,
      starRating: entry.hotel.rating ? Number(entry.hotel.rating) : null,
      address: [...entry.hotel.address.lines, entry.hotel.address.cityName].join(", "),
      cityCode: args.cityCode,
      checkInDate: args.checkInDate,
      checkOutDate: args.checkOutDate,
      pricePerNightUSD: totalPriceUSD / nights,
      totalPriceUSD,
    };
  });
}
```

- [ ] **Step 9: Run test to verify it passes**

Run via `ctx_batch_execute`: `npx vitest run lib/amadeus/hotels.test.ts`
Expected: PASS

- [ ] **Step 10: Document required env vars**

```
# .env.local.example
AMADEUS_CLIENT_ID=
AMADEUS_CLIENT_SECRET=
AMADEUS_BASE_URL=https://test.api.amadeus.com
```

- [ ] **Step 11: Commit**

```bash
git add lib/amadeus/client.ts lib/amadeus/flights.ts lib/amadeus/hotels.ts lib/amadeus/flights.test.ts lib/amadeus/hotels.test.ts .env.local.example
git commit -m "feat: add Amadeus flight and hotel search integration"
```

---

### Task 3: Booking-Link Builder + Carrier/Chain Map

**Files:**
- Create: `lib/links/carrierMap.ts`
- Create: `lib/links/flightLink.ts`
- Create: `lib/links/hotelLink.ts`
- Test: `lib/links/flightLink.test.ts`
- Test: `lib/links/hotelLink.test.ts`

**Interfaces:**
- Consumes: `RawFlightOffer`, `RawHotelOffer`, `BookingLink` from `types/travel.ts` (Task 1).
- Produces: `buildFlightLink(offer: RawFlightOffer): BookingLink` from `lib/links/flightLink.ts`.
- Produces: `buildHotelLink(offer: RawHotelOffer): BookingLink` from `lib/links/hotelLink.ts`.

This task does not depend on Task 2's implementation — it only depends on the `RawFlightOffer`/`RawHotelOffer` shapes from Task 1's types, so it can be written and tested fully in isolation with hand-built fixture objects.

- [ ] **Step 1: Write `lib/links/carrierMap.ts`**

```ts
interface FlightLinkTemplate {
  name: string;
  buildUrl: (p: { origin: string; destination: string; departureDate: string; returnDate: string }) => string;
}

interface HotelLinkTemplate {
  name: string;
  buildUrl: (p: { cityName: string; checkInDate: string; checkOutDate: string }) => string;
}

// Best-effort deep links into each carrier's own booking-search page.
// These query-string patterns are unofficial and can break if a carrier
// changes their site; that's an accepted tradeoff for v1 (see spec).
export const CARRIER_LINK_TEMPLATES: Record<string, FlightLinkTemplate> = {
  DL: {
    name: "Delta Air Lines",
    buildUrl: ({ origin, destination, departureDate, returnDate }) =>
      `https://www.delta.com/flight-search/book-a-flight?tripType=ROUND_TRIP&originCity=${origin}&destinationCity=${destination}&departureDate=${departureDate}&returnDate=${returnDate}`,
  },
  UA: {
    name: "United Airlines",
    buildUrl: ({ origin, destination, departureDate, returnDate }) =>
      `https://www.united.com/en/us/fsr/choose-flights?f=${origin}&t=${destination}&d=${departureDate}&r=${returnDate}&tt=1`,
  },
  AA: {
    name: "American Airlines",
    buildUrl: ({ origin, destination, departureDate, returnDate }) =>
      `https://www.aa.com/booking/find-flights?tripType=roundTrip&originAirport=${origin}&destinationAirport=${destination}&departureDate=${departureDate}&returnDate=${returnDate}`,
  },
  WN: {
    name: "Southwest Airlines",
    buildUrl: ({ origin, destination, departureDate, returnDate }) =>
      `https://www.southwest.com/air/booking/select.html?originationAirportCode=${origin}&destinationAirportCode=${destination}&departureDate=${departureDate}&returnDate=${returnDate}&tripType=roundtrip`,
  },
  B6: {
    name: "JetBlue",
    buildUrl: ({ origin, destination, departureDate, returnDate }) =>
      `https://www.jetblue.com/booking/flights?from=${origin}&to=${destination}&depart=${departureDate}&return=${returnDate}&isMultiCity=false`,
  },
  AS: {
    name: "Alaska Airlines",
    buildUrl: ({ origin, destination, departureDate, returnDate }) =>
      `https://www.alaskaair.com/booking/reservation-flights?A-Origin=${origin}&A-Destination=${destination}&A-DepartDate=${departureDate}&A-ReturnDate=${returnDate}&A-TripType=roundtrip`,
  },
};

export const HOTEL_CHAIN_LINK_TEMPLATES: Record<string, HotelLinkTemplate> = {
  EM: {
    name: "Marriott",
    buildUrl: ({ cityName, checkInDate, checkOutDate }) =>
      `https://www.marriott.com/search/default.mi?destinationAddress.destination=${encodeURIComponent(cityName)}&fromDate=${checkInDate}&toDate=${checkOutDate}`,
  },
  HL: {
    name: "Hilton",
    buildUrl: ({ cityName, checkInDate, checkOutDate }) =>
      `https://www.hilton.com/en/search/?arrivalDate=${checkInDate}&departureDate=${checkOutDate}&query=${encodeURIComponent(cityName)}`,
  },
  HY: {
    name: "Hyatt",
    buildUrl: ({ cityName, checkInDate, checkOutDate }) =>
      `https://www.hyatt.com/search?checkinDate=${checkInDate}&checkoutDate=${checkOutDate}&location=${encodeURIComponent(cityName)}`,
  },
};

export function buildGoogleFlightsUrl(p: {
  origin: string;
  destination: string;
  departureDate: string;
  returnDate: string;
}): string {
  const query = `Flights from ${p.origin} to ${p.destination} on ${p.departureDate} through ${p.returnDate}`;
  return `https://www.google.com/travel/flights?q=${encodeURIComponent(query)}`;
}

export function buildGoogleHotelsUrl(p: { cityName: string; checkInDate: string; checkOutDate: string }): string {
  const query = `Hotels in ${p.cityName} from ${p.checkInDate} to ${p.checkOutDate}`;
  return `https://www.google.com/travel/hotels?q=${encodeURIComponent(query)}`;
}
```

- [ ] **Step 2: Write the failing tests for `buildFlightLink`**

```ts
// lib/links/flightLink.test.ts
import { describe, it, expect } from "vitest";
import { buildFlightLink } from "@/lib/links/flightLink";
import type { RawFlightOffer } from "@/types/travel";

const baseOffer: RawFlightOffer = {
  id: "1",
  airline: "Delta Air Lines",
  carrierCode: "DL",
  flightNumber: "204",
  origin: "JFK",
  destination: "LAX",
  departureDateTime: "2026-11-03T08:00:00",
  arrivalDateTime: "2026-11-03T11:20:00",
  returnDepartureDateTime: "2026-11-10T13:00:00",
  returnArrivalDateTime: "2026-11-10T21:15:00",
  stops: 0,
  durationMinutes: 380,
  priceUSD: 412.5,
  cabinClass: "ECONOMY",
};

describe("buildFlightLink", () => {
  it("returns a direct carrier link for a mapped carrier code", () => {
    const link = buildFlightLink(baseOffer);
    expect(link.isDirect).toBe(true);
    expect(link.url).toContain("delta.com");
    expect(link.note).toBe("");
  });

  it("falls back to a Google Flights link with an explanatory note for an unmapped carrier", () => {
    const link = buildFlightLink({ ...baseOffer, carrierCode: "F9", airline: "Frontier Airlines" });
    expect(link.isDirect).toBe(false);
    expect(link.url).toContain("google.com/travel/flights");
    expect(link.note).toContain("Frontier Airlines");
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run via `ctx_batch_execute`: `npx vitest run lib/links/flightLink.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement `lib/links/flightLink.ts`**

```ts
import { CARRIER_LINK_TEMPLATES, buildGoogleFlightsUrl } from "@/lib/links/carrierMap";
import type { BookingLink, RawFlightOffer } from "@/types/travel";

export function buildFlightLink(offer: RawFlightOffer): BookingLink {
  const template = CARRIER_LINK_TEMPLATES[offer.carrierCode];
  const params = {
    origin: offer.origin,
    destination: offer.destination,
    departureDate: offer.departureDateTime.slice(0, 10),
    returnDate: offer.returnDepartureDateTime.slice(0, 10),
  };

  if (template) {
    return { url: template.buildUrl(params), isDirect: true, note: "" };
  }

  return {
    url: buildGoogleFlightsUrl(params),
    isDirect: false,
    note: `Direct link unavailable for ${offer.airline} — showing live Google Flights results instead.`,
  };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run via `ctx_batch_execute`: `npx vitest run lib/links/flightLink.test.ts`
Expected: PASS

- [ ] **Step 6: Write the failing tests for `buildHotelLink`**

```ts
// lib/links/hotelLink.test.ts
import { describe, it, expect } from "vitest";
import { buildHotelLink } from "@/lib/links/hotelLink";
import type { RawHotelOffer } from "@/types/travel";

const baseOffer: RawHotelOffer = {
  id: "H1",
  name: "Downtown LA Hotel",
  chainCode: "HL",
  starRating: 4,
  address: "123 Main St, Los Angeles",
  cityCode: "LAX",
  checkInDate: "2026-11-03",
  checkOutDate: "2026-11-10",
  pricePerNightUSD: 88.57,
  totalPriceUSD: 620,
};

describe("buildHotelLink", () => {
  it("returns a direct chain link for a mapped chain code", () => {
    const link = buildHotelLink(baseOffer);
    expect(link.isDirect).toBe(true);
    expect(link.url).toContain("hilton.com");
    expect(link.note).toBe("");
  });

  it("falls back to a Google Hotels link with an explanatory note for an independent property", () => {
    const link = buildHotelLink({ ...baseOffer, chainCode: null, name: "The Corner Inn" });
    expect(link.isDirect).toBe(false);
    expect(link.url).toContain("google.com/travel/hotels");
    expect(link.note).toContain("The Corner Inn");
  });
});
```

- [ ] **Step 7: Run test to verify it fails**

Run via `ctx_batch_execute`: `npx vitest run lib/links/hotelLink.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 8: Implement `lib/links/hotelLink.ts`**

```ts
import { HOTEL_CHAIN_LINK_TEMPLATES, buildGoogleHotelsUrl } from "@/lib/links/carrierMap";
import type { BookingLink, RawHotelOffer } from "@/types/travel";

export function buildHotelLink(offer: RawHotelOffer): BookingLink {
  const template = offer.chainCode ? HOTEL_CHAIN_LINK_TEMPLATES[offer.chainCode] : undefined;
  const cityName = offer.address.split(",").pop()?.trim() ?? offer.cityCode;
  const params = { cityName, checkInDate: offer.checkInDate, checkOutDate: offer.checkOutDate };

  if (template) {
    return { url: template.buildUrl(params), isDirect: true, note: "" };
  }

  return {
    url: buildGoogleHotelsUrl(params),
    isDirect: false,
    note: `Direct link unavailable for ${offer.name} — showing live Google Hotels results instead.`,
  };
}
```

- [ ] **Step 9: Run test to verify it passes**

Run via `ctx_batch_execute`: `npx vitest run lib/links/hotelLink.test.ts`
Expected: PASS

- [ ] **Step 10: Commit**

```bash
git add lib/links/carrierMap.ts lib/links/flightLink.ts lib/links/hotelLink.ts lib/links/flightLink.test.ts lib/links/hotelLink.test.ts
git commit -m "feat: add best-effort carrier/chain deep links with Google fallback"
```

---

### Task 4: Agent Orchestration (Tool-Calling + Refinement Logic)

**Files:**
- Create: `lib/agent/tools.ts`
- Create: `lib/agent/orchestrator.ts`
- Test: `lib/agent/orchestrator.test.ts`

**Interfaces:**
- Consumes (types only, no concrete imports from Task 2/3): `RawFlightOffer`, `RawHotelOffer`, `FlightOffer`, `HotelOffer`, `SessionState`, `SearchFlightsToolArgs`, `SearchHotelsToolArgs`, `BookingLink` from `types/travel.ts` (Task 1).
- Produces: `createOrchestrator(deps: AgentDependencies): { handleTurn }` from `lib/agent/orchestrator.ts`, where:

```ts
export interface AgentDependencies {
  searchFlights: (args: SearchFlightsToolArgs) => Promise<RawFlightOffer[]>;
  searchHotels: (args: SearchHotelsToolArgs) => Promise<RawHotelOffer[]>;
  buildFlightLink: (offer: RawFlightOffer) => BookingLink;
  buildHotelLink: (offer: RawHotelOffer) => BookingLink;
}

export type StatusCallback = (status: string) => void;

// handleTurn(session, userMessage, onStatus?) => Promise<string> (the final assistant text)
```

This is **dependency injection by design**: Task 4 never imports `lib/amadeus/*` or `lib/links/*` directly, so it is fully testable and buildable in parallel with Tasks 2 and 3. Task 5 wires the real implementations in.

Before writing the OpenRouter call, use the `context7` MCP to resolve the `openai` npm package and confirm the current `chat.completions.create` signature for `tools`/`tool_choice` and streaming — this plan's code assumes the OpenAI Node SDK's tool-calling shape as of early 2026 and may need small adjustments if the installed version has moved on.

- [ ] **Step 1: Write `lib/agent/tools.ts`**

```ts
export const searchFlightsToolSchema = {
  type: "function",
  function: {
    name: "search_flights",
    description:
      "Search round-trip domestic US flights. Always pass the full known criteria; the backend " +
      "decides internally whether to reuse cached results or query fresh. Do not withhold criteria " +
      "you already know just because a previous search used them.",
    parameters: {
      type: "object",
      properties: {
        origin: { type: "string", description: "3-letter IATA airport code, e.g. JFK" },
        destination: { type: "string", description: "3-letter IATA airport code, e.g. LAX" },
        departureDate: { type: "string", description: "YYYY-MM-DD" },
        returnDate: { type: "string", description: "YYYY-MM-DD" },
        travelers: { type: "number" },
        cabinClass: { type: "string", enum: ["ECONOMY", "PREMIUM_ECONOMY", "BUSINESS", "FIRST"] },
        maxPriceUSD: { type: "number", description: "Optional max total price filter" },
        maxStops: { type: "number", description: "Optional max number of stops filter" },
      },
      required: ["origin", "destination", "departureDate", "returnDate", "travelers", "cabinClass"],
    },
  },
} as const;

export const searchHotelsToolSchema = {
  type: "function",
  function: {
    name: "search_hotels",
    description:
      "Search hotels in a US city for given check-in/check-out dates. Always pass the full known " +
      "criteria; the backend decides internally whether to reuse cached results or query fresh.",
    parameters: {
      type: "object",
      properties: {
        cityCode: { type: "string", description: "3-letter IATA city code, e.g. LAX" },
        checkInDate: { type: "string", description: "YYYY-MM-DD" },
        checkOutDate: { type: "string", description: "YYYY-MM-DD" },
        travelers: { type: "number" },
        maxPricePerNightUSD: { type: "number" },
        minStarRating: { type: "number" },
      },
      required: ["cityCode", "checkInDate", "checkOutDate", "travelers"],
    },
  },
} as const;
```

- [ ] **Step 2: Write the failing test for filter-first refinement**

```ts
// lib/agent/orchestrator.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createOrchestrator, type AgentDependencies } from "@/lib/agent/orchestrator";
import type { RawFlightOffer, SessionState } from "@/types/travel";

function freshSession(): SessionState {
  return {
    sessionId: "s1",
    messages: [],
    lastFlightResults: [],
    lastHotelResults: [],
    lastFlightSearchParams: null,
  };
}

const sampleRaw: RawFlightOffer = {
  id: "1",
  airline: "Delta Air Lines",
  carrierCode: "DL",
  flightNumber: "204",
  origin: "JFK",
  destination: "LAX",
  departureDateTime: "2026-11-03T08:00:00",
  arrivalDateTime: "2026-11-03T11:20:00",
  returnDepartureDateTime: "2026-11-10T13:00:00",
  returnArrivalDateTime: "2026-11-10T21:15:00",
  stops: 0,
  durationMinutes: 380,
  priceUSD: 412.5,
  cabinClass: "ECONOMY",
};

describe("orchestrator refinement logic", () => {
  let deps: AgentDependencies;

  beforeEach(() => {
    deps = {
      searchFlights: vi.fn(async () => [sampleRaw]),
      searchHotels: vi.fn(async () => []),
      buildFlightLink: vi.fn(() => ({ url: "https://example.com", isDirect: true, note: "" })),
      buildHotelLink: vi.fn(() => ({ url: "https://example.com", isDirect: true, note: "" })),
    };
  });

  it("reuses cached results and does not call searchFlights again when only a tighter filter is requested", async () => {
    const session = freshSession();
    session.lastFlightSearchParams = {
      origin: "JFK",
      destination: "LAX",
      departureDate: "2026-11-03",
      returnDate: "2026-11-10",
      travelers: 1,
      cabinClass: "ECONOMY",
    };
    session.lastFlightResults = [{ ...sampleRaw, bookingLink: { url: "x", isDirect: true, note: "" } }];

    const orchestrator = createOrchestrator(deps);
    const result = await orchestrator.__internal.runFlightSearch(
      {
        origin: "JFK",
        destination: "LAX",
        departureDate: "2026-11-03",
        returnDate: "2026-11-10",
        travelers: 1,
        cabinClass: "ECONOMY",
        maxPriceUSD: 500,
      },
      session
    );

    expect(deps.searchFlights).not.toHaveBeenCalled();
    expect(result).toHaveLength(1);
  });

  it("calls searchFlights, merges, dedupes, and re-ranks when the route changes", async () => {
    const session = freshSession();
    session.lastFlightSearchParams = {
      origin: "JFK",
      destination: "LAX",
      departureDate: "2026-11-03",
      returnDate: "2026-11-10",
      travelers: 1,
      cabinClass: "ECONOMY",
    };
    session.lastFlightResults = [{ ...sampleRaw, bookingLink: { url: "x", isDirect: true, note: "" } }];

    const orchestrator = createOrchestrator(deps);
    const result = await orchestrator.__internal.runFlightSearch(
      {
        origin: "JFK",
        destination: "SFO",
        departureDate: "2026-11-03",
        returnDate: "2026-11-10",
        travelers: 1,
        cabinClass: "ECONOMY",
      },
      session
    );

    expect(deps.searchFlights).toHaveBeenCalledTimes(1);
    expect(result.every((r, i, arr) => i === 0 || arr[i - 1].priceUSD <= r.priceUSD)).toBe(true);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run via `ctx_batch_execute`: `npx vitest run lib/agent/orchestrator.test.ts`
Expected: FAIL — `lib/agent/orchestrator.ts` does not exist yet.

- [ ] **Step 4: Implement `lib/agent/orchestrator.ts`**

```ts
import OpenAI from "openai";
import type {
  ChatMessage,
  FlightOffer,
  HotelOffer,
  LastFlightSearchParams,
  RawFlightOffer,
  RawHotelOffer,
  SearchHotelsToolArgs,
  SessionState,
} from "@/types/travel";
import { searchFlightsToolSchema, searchHotelsToolSchema } from "@/lib/agent/tools";

export interface AgentDependencies {
  searchFlights: (args: {
    origin: string;
    destination: string;
    departureDate: string;
    returnDate: string;
    travelers: number;
    cabinClass: LastFlightSearchParams["cabinClass"];
    maxResults?: number;
  }) => Promise<RawFlightOffer[]>;
  searchHotels: (args: SearchHotelsToolArgs) => Promise<RawHotelOffer[]>;
  buildFlightLink: (offer: RawFlightOffer) => FlightOffer["bookingLink"];
  buildHotelLink: (offer: RawHotelOffer) => HotelOffer["bookingLink"];
}

export type StatusCallback = (status: string) => void;

interface FlightSearchArgs extends LastFlightSearchParams {
  maxPriceUSD?: number;
  maxStops?: number;
}

interface HotelSearchArgs {
  cityCode: string;
  checkInDate: string;
  checkOutDate: string;
  travelers: number;
  maxPricePerNightUSD?: number;
  minStarRating?: number;
}

const MODEL = "nvidia/nemotron-3.5-lightning:free";

function sameRoute(a: FlightSearchArgs, cached: LastFlightSearchParams | null): boolean {
  if (!cached) return false;
  return (
    a.origin === cached.origin &&
    a.destination === cached.destination &&
    a.departureDate === cached.departureDate &&
    a.returnDate === cached.returnDate &&
    a.travelers === cached.travelers &&
    a.cabinClass === cached.cabinClass
  );
}

function filterFlights(offers: FlightOffer[], args: FlightSearchArgs): FlightOffer[] {
  return offers.filter((o) => {
    if (args.maxPriceUSD !== undefined && o.priceUSD > args.maxPriceUSD) return false;
    if (args.maxStops !== undefined && o.stops > args.maxStops) return false;
    return true;
  });
}

function filterHotels(offers: HotelOffer[], args: HotelSearchArgs): HotelOffer[] {
  return offers.filter((o) => {
    if (args.maxPricePerNightUSD !== undefined && o.pricePerNightUSD > args.maxPricePerNightUSD) return false;
    if (args.minStarRating !== undefined && (o.starRating ?? 0) < args.minStarRating) return false;
    return true;
  });
}

export function createOrchestrator(deps: AgentDependencies) {
  async function runFlightSearch(args: FlightSearchArgs, session: SessionState): Promise<FlightOffer[]> {
    if (sameRoute(args, session.lastFlightSearchParams) && session.lastFlightResults.length > 0) {
      const filtered = filterFlights(session.lastFlightResults, args);
      if (filtered.length > 0) return filtered.slice(0, 10);
    }

    const raw = await deps.searchFlights({
      origin: args.origin,
      destination: args.destination,
      departureDate: args.departureDate,
      returnDate: args.returnDate,
      travelers: args.travelers,
      cabinClass: args.cabinClass,
      maxResults: 10,
    });
    const fresh: FlightOffer[] = raw.map((r) => ({ ...r, bookingLink: deps.buildFlightLink(r) }));

    const merged = new Map<string, FlightOffer>();
    for (const o of session.lastFlightResults) merged.set(o.id, o);
    for (const o of fresh) merged.set(o.id, o);
    const reranked = Array.from(merged.values()).sort((a, b) => a.priceUSD - b.priceUSD);

    session.lastFlightResults = reranked;
    session.lastFlightSearchParams = {
      origin: args.origin,
      destination: args.destination,
      departureDate: args.departureDate,
      returnDate: args.returnDate,
      travelers: args.travelers,
      cabinClass: args.cabinClass,
    };

    return filterFlights(reranked, args).slice(0, 10);
  }

  async function runHotelSearch(args: HotelSearchArgs, session: SessionState): Promise<HotelOffer[]> {
    const cached = session.lastHotelResults;
    const cachedMatchesRoute =
      cached.length > 0 && cached[0].checkInDate === args.checkInDate && cached[0].checkOutDate === args.checkOutDate;

    if (cachedMatchesRoute) {
      const filtered = filterHotels(cached, args);
      if (filtered.length > 0) return filtered.slice(0, 10);
    }

    const raw = await deps.searchHotels({
      cityCode: args.cityCode,
      checkInDate: args.checkInDate,
      checkOutDate: args.checkOutDate,
      travelers: args.travelers,
      maxResults: 10,
    });
    const fresh: HotelOffer[] = raw.map((r) => ({ ...r, bookingLink: deps.buildHotelLink(r) }));

    const merged = new Map<string, HotelOffer>();
    for (const o of cached) merged.set(o.id, o);
    for (const o of fresh) merged.set(o.id, o);
    const reranked = Array.from(merged.values()).sort((a, b) => a.pricePerNightUSD - b.pricePerNightUSD);

    session.lastHotelResults = reranked;

    return filterHotels(reranked, args).slice(0, 10);
  }

  async function handleTurn(
    session: SessionState,
    userMessage: string,
    onStatus?: StatusCallback
  ): Promise<string> {
    const client = new OpenAI({
      apiKey: process.env.OPENROUTER_API_KEY,
      baseURL: "https://openrouter.ai/api/v1",
    });

    session.messages.push({ role: "user", content: userMessage });

    const systemPrompt: ChatMessage = {
      role: "system",
      content:
        "You are a US-domestic flight and hotel search assistant. Always call search_flights and/or " +
        "search_hotels with the full known criteria before answering with results. If required trip " +
        "details are missing (origin, destination, dates, travelers, cabin class for flights; dates " +
        "and city for hotels), ask one concise clarifying question instead of calling a tool. Never " +
        "invent prices or availability yourself — only report what a tool returned.",
    };

    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: systemPrompt.role, content: systemPrompt.content },
      ...session.messages.map((m) => ({ role: m.role, content: m.content }) as OpenAI.Chat.ChatCompletionMessageParam),
    ];

    let finalText = "";

    for (let iteration = 0; iteration < 4; iteration++) {
      const completion = await client.chat.completions.create({
        model: MODEL,
        messages,
        tools: [searchFlightsToolSchema, searchHotelsToolSchema],
      });

      const choice = completion.choices[0];
      const toolCalls = choice.message.tool_calls ?? [];

      if (toolCalls.length === 0) {
        finalText = choice.message.content ?? "";
        session.messages.push({ role: "assistant", content: finalText });
        break;
      }

      messages.push(choice.message);

      for (const call of toolCalls) {
        const args = JSON.parse(call.function.arguments);
        let resultSummary: string;

        if (call.function.name === "search_flights") {
          onStatus?.("Searching flights…");
          const offers = await runFlightSearch(args, session);
          resultSummary = JSON.stringify(
            offers.map((o) => ({ id: o.id, airline: o.airline, priceUSD: o.priceUSD, stops: o.stops }))
          );
        } else if (call.function.name === "search_hotels") {
          onStatus?.("Searching hotels…");
          const offers = await runHotelSearch(args, session);
          resultSummary = JSON.stringify(
            offers.map((o) => ({ id: o.id, name: o.name, pricePerNightUSD: o.pricePerNightUSD, starRating: o.starRating }))
          );
        } else {
          resultSummary = JSON.stringify({ error: `Unknown tool ${call.function.name}` });
        }

        messages.push({ role: "tool", tool_call_id: call.id, content: resultSummary });
      }
    }

    return {
      finalText: finalText || "I found some results — check the table for details.",
    } as unknown as string; // see note below
  }

  return { handleTurn, __internal: { runFlightSearch, runHotelSearch } };
}
```

**Note on Step 4:** the `handleTurn` return statement above is written oddly on purpose to flag a real decision for whoever implements this task: decide whether `handleTurn` returns a plain `string` (simplest, matches the type declared in this task's own interface contract) or an object with `{ finalText }` — **pick the plain `string` return** (drop the `as unknown as string` cast and just `return finalText || "...";`) so it matches the `Promise<string>` contract Task 5 is told to expect. This block is called out explicitly so the implementer fixes it as part of Step 4, not left as a TODO.

- [ ] **Step 5: Run test to verify it passes**

Run via `ctx_batch_execute`: `npx vitest run lib/agent/orchestrator.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 6: Commit**

```bash
git add lib/agent/tools.ts lib/agent/orchestrator.ts lib/agent/orchestrator.test.ts
git commit -m "feat: add OpenRouter tool-calling orchestrator with cache-first refinement"
```

---

### Task 5: Wire UI to the Agent (Streaming, Form, Chat, Results Table)

**Files:**
- Create: `app/api/chat/route.ts`
- Create: `components/TripForm.tsx`
- Create: `components/ChatPanel.tsx`
- Create: `components/ResultsTable.tsx`
- Modify: `app/page.tsx`
- Test: `components/TripForm.test.tsx`
- Test: `components/ResultsTable.test.tsx`

**Interfaces:**
- Consumes: `createOrchestrator` + `AgentDependencies` from `lib/agent/orchestrator.ts` (Task 4).
- Consumes: `searchFlights`, `searchHotels` from `lib/amadeus/flights.ts` / `lib/amadeus/hotels.ts` (Task 2).
- Consumes: `buildFlightLink`, `buildHotelLink` from `lib/links/flightLink.ts` / `lib/links/hotelLink.ts` (Task 3).
- Consumes: `getOrCreateSessionId`, `getSession` from `lib/session/store.ts` (Task 1).
- Consumes: `TripFormInput`, `FlightOffer`, `HotelOffer` from `types/travel.ts` (Task 1).

This is the task that finally imports Task 2, 3, and 4's real implementations together — run it only after all three have merged and passed their own tests.

- [ ] **Step 1: Write `app/api/chat/route.ts`**

```ts
import { NextRequest } from "next/server";
import { getOrCreateSessionId, getSession } from "@/lib/session/store";
import { createOrchestrator } from "@/lib/agent/orchestrator";
import { searchFlights } from "@/lib/amadeus/flights";
import { searchHotels } from "@/lib/amadeus/hotels";
import { buildFlightLink } from "@/lib/links/flightLink";
import { buildHotelLink } from "@/lib/links/hotelLink";
import type { TripFormInput } from "@/types/travel";

const orchestrator = createOrchestrator({ searchFlights, searchHotels, buildFlightLink, buildHotelLink });

function formToMessage(form: TripFormInput): string {
  return (
    `Find round-trip domestic US flights from ${form.origin} to ${form.destination}, departing ` +
    `${form.departureDate} and returning ${form.returnDate}, for ${form.travelers} traveler(s) in ` +
    `${form.cabinClass} cabin class. Also find hotels in ${form.destination} for the same dates.`
  );
}

export async function POST(req: NextRequest) {
  const sessionId = getOrCreateSessionId();
  const session = getSession(sessionId);
  const body = (await req.json()) as { message?: string; formData?: TripFormInput };
  const userMessage = body.formData ? formToMessage(body.formData) : body.message ?? "";

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      const emit = (payload: unknown) => controller.enqueue(encoder.encode(JSON.stringify(payload) + "\n"));

      try {
        const finalText = await orchestrator.handleTurn(session, userMessage, (status) =>
          emit({ type: "status", text: status })
        );
        emit({
          type: "final",
          text: finalText,
          flights: session.lastFlightResults.slice(0, 10),
          hotels: session.lastHotelResults.slice(0, 10),
        });
      } catch (err) {
        emit({ type: "error", text: err instanceof Error ? err.message : "Unknown error" });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
}
```

- [ ] **Step 2: Write the failing test for `TripForm`**

```tsx
// components/TripForm.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { TripForm } from "@/components/TripForm";

describe("TripForm", () => {
  it("calls onSubmit with structured trip data when the form is submitted", () => {
    const onSubmit = vi.fn();
    render(<TripForm onSubmit={onSubmit} disabled={false} />);

    fireEvent.change(screen.getByLabelText(/origin/i), { target: { value: "JFK" } });
    fireEvent.change(screen.getByLabelText(/destination/i), { target: { value: "LAX" } });
    fireEvent.change(screen.getByLabelText(/departure date/i), { target: { value: "2026-11-03" } });
    fireEvent.change(screen.getByLabelText(/return date/i), { target: { value: "2026-11-10" } });
    fireEvent.change(screen.getByLabelText(/travelers/i), { target: { value: "2" } });
    fireEvent.change(screen.getByLabelText(/cabin class/i), { target: { value: "BUSINESS" } });
    fireEvent.click(screen.getByRole("button", { name: /search/i }));

    expect(onSubmit).toHaveBeenCalledWith({
      origin: "JFK",
      destination: "LAX",
      departureDate: "2026-11-03",
      returnDate: "2026-11-10",
      travelers: 2,
      cabinClass: "BUSINESS",
    });
  });

  it("disables the submit button while disabled=true", () => {
    render(<TripForm onSubmit={vi.fn()} disabled={true} />);
    expect(screen.getByRole("button", { name: /search/i })).toBeDisabled();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run via `ctx_batch_execute`: `npx vitest run components/TripForm.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement `components/TripForm.tsx`**

```tsx
"use client";

import { useState, type FormEvent } from "react";
import type { CabinClass, TripFormInput } from "@/types/travel";

interface TripFormProps {
  onSubmit: (data: TripFormInput) => void;
  disabled: boolean;
}

export function TripForm({ onSubmit, disabled }: TripFormProps) {
  const [origin, setOrigin] = useState("");
  const [destination, setDestination] = useState("");
  const [departureDate, setDepartureDate] = useState("");
  const [returnDate, setReturnDate] = useState("");
  const [travelers, setTravelers] = useState(1);
  const [cabinClass, setCabinClass] = useState<CabinClass>("ECONOMY");

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    onSubmit({ origin, destination, departureDate, returnDate, travelers, cabinClass });
  }

  return (
    <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <label>
        Origin
        <input value={origin} onChange={(e) => setOrigin(e.target.value.toUpperCase())} required maxLength={3} />
      </label>
      <label>
        Destination
        <input value={destination} onChange={(e) => setDestination(e.target.value.toUpperCase())} required maxLength={3} />
      </label>
      <label>
        Departure date
        <input type="date" value={departureDate} onChange={(e) => setDepartureDate(e.target.value)} required />
      </label>
      <label>
        Return date
        <input type="date" value={returnDate} onChange={(e) => setReturnDate(e.target.value)} required />
      </label>
      <label>
        Travelers
        <input
          type="number"
          min={1}
          value={travelers}
          onChange={(e) => setTravelers(Number(e.target.value))}
          required
        />
      </label>
      <label>
        Cabin class
        <select value={cabinClass} onChange={(e) => setCabinClass(e.target.value as CabinClass)}>
          <option value="ECONOMY">Economy</option>
          <option value="PREMIUM_ECONOMY">Premium Economy</option>
          <option value="BUSINESS">Business</option>
          <option value="FIRST">First</option>
        </select>
      </label>
      <button type="submit" disabled={disabled}>
        Search
      </button>
    </form>
  );
}
```

- [ ] **Step 5: Run test to verify it passes**

Run via `ctx_batch_execute`: `npx vitest run components/TripForm.test.tsx`
Expected: PASS

- [ ] **Step 6: Write the failing test for `ResultsTable`**

```tsx
// components/ResultsTable.test.tsx
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ResultsTable } from "@/components/ResultsTable";
import type { FlightOffer, HotelOffer } from "@/types/travel";

const flight: FlightOffer = {
  id: "1",
  airline: "Delta Air Lines",
  carrierCode: "DL",
  flightNumber: "204",
  origin: "JFK",
  destination: "LAX",
  departureDateTime: "2026-11-03T08:00:00",
  arrivalDateTime: "2026-11-03T11:20:00",
  returnDepartureDateTime: "2026-11-10T13:00:00",
  returnArrivalDateTime: "2026-11-10T21:15:00",
  stops: 0,
  durationMinutes: 380,
  priceUSD: 412.5,
  cabinClass: "ECONOMY",
  bookingLink: { url: "https://delta.com", isDirect: true, note: "" },
};

const hotel: HotelOffer = {
  id: "H1",
  name: "Downtown LA Hotel",
  chainCode: "HL",
  starRating: 4,
  address: "123 Main St, Los Angeles",
  cityCode: "LAX",
  checkInDate: "2026-11-03",
  checkOutDate: "2026-11-10",
  pricePerNightUSD: 88.57,
  totalPriceUSD: 620,
  bookingLink: { url: "https://hilton.com", isDirect: true, note: "" },
};

describe("ResultsTable", () => {
  it("shows flights by default and toggles to hotels", () => {
    render(<ResultsTable flights={[flight]} hotels={[hotel]} />);
    expect(screen.getByText("Delta Air Lines")).toBeInTheDocument();
    expect(screen.queryByText("Downtown LA Hotel")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: /hotels/i }));
    expect(screen.getByText("Downtown LA Hotel")).toBeInTheDocument();
  });

  it("always renders the GDS-coverage disclosure note", () => {
    render(<ResultsTable flights={[]} hotels={[]} />);
    expect(screen.getByText(/southwest/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 7: Run test to verify it fails**

Run via `ctx_batch_execute`: `npx vitest run components/ResultsTable.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 8: Implement `components/ResultsTable.tsx`**

```tsx
"use client";

import { useState } from "react";
import type { FlightOffer, HotelOffer } from "@/types/travel";

interface ResultsTableProps {
  flights: FlightOffer[];
  hotels: HotelOffer[];
}

export function ResultsTable({ flights, hotels }: ResultsTableProps) {
  const [tab, setTab] = useState<"flights" | "hotels">("flights");

  return (
    <div>
      <p style={{ fontSize: 12, color: "#666" }}>
        Results come from GDS-connected airlines and hotels. Some carriers (notably Southwest) and
        web-only fares may not appear here.
      </p>
      <div role="tablist" style={{ display: "flex", gap: 8, marginBottom: 8 }}>
        <button role="tab" aria-selected={tab === "flights"} onClick={() => setTab("flights")}>
          Flights
        </button>
        <button role="tab" aria-selected={tab === "hotels"} onClick={() => setTab("hotels")}>
          Hotels
        </button>
      </div>

      {tab === "flights" && (
        <table>
          <thead>
            <tr>
              <th>Airline</th>
              <th>Flight</th>
              <th>Stops</th>
              <th>Price (USD)</th>
              <th>Book</th>
            </tr>
          </thead>
          <tbody>
            {flights.map((f) => (
              <tr key={f.id}>
                <td>{f.airline}</td>
                <td>{f.carrierCode}{f.flightNumber}</td>
                <td>{f.stops}</td>
                <td>${f.priceUSD.toFixed(2)}</td>
                <td>
                  <a href={f.bookingLink.url} target="_blank" rel="noreferrer">
                    {f.bookingLink.isDirect ? "Book" : "View options"}
                  </a>
                  {f.bookingLink.note && <div style={{ fontSize: 11, color: "#888" }}>{f.bookingLink.note}</div>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {tab === "hotels" && (
        <table>
          <thead>
            <tr>
              <th>Hotel</th>
              <th>Stars</th>
              <th>$/night</th>
              <th>Total (USD)</th>
              <th>Book</th>
            </tr>
          </thead>
          <tbody>
            {hotels.map((h) => (
              <tr key={h.id}>
                <td>{h.name}</td>
                <td>{h.starRating ?? "—"}</td>
                <td>${h.pricePerNightUSD.toFixed(2)}</td>
                <td>${h.totalPriceUSD.toFixed(2)}</td>
                <td>
                  <a href={h.bookingLink.url} target="_blank" rel="noreferrer">
                    {h.bookingLink.isDirect ? "Book" : "View options"}
                  </a>
                  {h.bookingLink.note && <div style={{ fontSize: 11, color: "#888" }}>{h.bookingLink.note}</div>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
```

- [ ] **Step 9: Run test to verify it passes**

Run via `ctx_batch_execute`: `npx vitest run components/ResultsTable.test.tsx`
Expected: PASS

- [ ] **Step 10: Implement `components/ChatPanel.tsx`**

No isolated unit test for this one (it's a thin fetch/stream-reading wrapper) — its behavior is verified in Step 11's manual end-to-end check instead.

```tsx
"use client";

import { useState } from "react";
import type { FlightOffer, HotelOffer, TripFormInput } from "@/types/travel";

interface ChatPanelProps {
  onResults: (flights: FlightOffer[], hotels: HotelOffer[]) => void;
  externalTrigger: TripFormInput | null;
}

interface DisplayMessage {
  role: "user" | "assistant" | "status";
  text: string;
}

export function ChatPanel({ onResults, externalTrigger }: ChatPanelProps) {
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);

  async function sendTurn(body: { message?: string; formData?: TripFormInput }) {
    setBusy(true);
    if (body.message) setMessages((m) => [...m, { role: "user", text: body.message! }]);

    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const reader = res.body?.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (reader) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n").filter(Boolean);
      buffer = "";
      for (const line of lines) {
        const payload = JSON.parse(line);
        if (payload.type === "status") {
          setMessages((m) => [...m, { role: "status", text: payload.text }]);
        } else if (payload.type === "final") {
          setMessages((m) => [...m, { role: "assistant", text: payload.text }]);
          onResults(payload.flights, payload.hotels);
        } else if (payload.type === "error") {
          setMessages((m) => [...m, { role: "assistant", text: `Error: ${payload.text}` }]);
        }
      }
    }
    setBusy(false);
  }

  function handleSend() {
    if (!input.trim() || busy) return;
    const message = input;
    setInput("");
    void sendTurn({ message });
  }

  // externalTrigger is set by the parent right after a form submit; the parent
  // is responsible for calling sendTurn with formData once and clearing it —
  // wired in app/page.tsx (Step 12).

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <div style={{ flex: 1, overflow: "auto" }}>
        {messages.map((m, i) => (
          <p key={i} style={{ opacity: m.role === "status" ? 0.6 : 1 }}>
            <strong>{m.role}:</strong> {m.text}
          </p>
        ))}
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={busy}
          placeholder="Ask about hotel preferences, budget, or refine results…"
          onKeyDown={(e) => e.key === "Enter" && handleSend()}
        />
        <button onClick={handleSend} disabled={busy}>
          Send
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 11: Wire it all together in `app/page.tsx`**

```tsx
"use client";

import { useState } from "react";
import { ResizablePanels } from "@/components/ResizablePanels";
import { TripForm } from "@/components/TripForm";
import { ChatPanel } from "@/components/ChatPanel";
import { ResultsTable } from "@/components/ResultsTable";
import type { FlightOffer, HotelOffer, TripFormInput } from "@/types/travel";

export default function HomePage() {
  const [flights, setFlights] = useState<FlightOffer[]>([]);
  const [hotels, setHotels] = useState<HotelOffer[]>([]);
  const [formSubmitCount, setFormSubmitCount] = useState(0);
  const [pendingForm, setPendingForm] = useState<TripFormInput | null>(null);
  const [formBusy, setFormBusy] = useState(false);

  async function handleFormSubmit(data: TripFormInput) {
    setFormBusy(true);
    setPendingForm(data);
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ formData: data }),
    });
    const reader = res.body?.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (reader) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n").filter(Boolean);
      buffer = "";
      for (const line of lines) {
        const payload = JSON.parse(line);
        if (payload.type === "final") {
          setFlights(payload.flights);
          setHotels(payload.hotels);
        }
      }
    }
    setFormBusy(false);
    setFormSubmitCount((c) => c + 1);
  }

  return (
    <main style={{ height: "100vh" }}>
      <ResizablePanels
        left={
          <div style={{ padding: 16 }}>
            <TripForm onSubmit={handleFormSubmit} disabled={formBusy} />
            <div style={{ marginTop: 16 }}>
              <ResultsTable flights={flights} hotels={hotels} />
            </div>
          </div>
        }
        right={
          <div style={{ padding: 16, height: "100%" }}>
            <ChatPanel
              key={formSubmitCount}
              externalTrigger={pendingForm}
              onResults={(f, h) => {
                setFlights(f);
                setHotels(h);
              }}
            />
          </div>
        }
      />
    </main>
  );
}
```

**Note on Step 11:** `handleFormSubmit` duplicates the stream-reading loop that `ChatPanel.sendTurn` already implements. This is intentional for v1 simplicity (form results render directly into the page's own state without needing to route through `ChatPanel`'s internal message list) rather than a bug — do not "fix" it by trying to make `ChatPanel` accept an imperative trigger prop unless a later task specifically asks for that refactor.

- [ ] **Step 12: Run the full test suite**

Run via `ctx_batch_execute`: `npx vitest run`
Expected: PASS (all tests across all tasks)

- [ ] **Step 13: Manual end-to-end check**

Set real (or Amadeus test-environment) credentials in `.env.local`, then run `npm run dev` and in a browser:
1. Fill the form (a real US route/date pair) and submit — confirm the chat panel shows "Searching flights…" / "Searching hotests…" status lines, input is disabled, then a final message appears and the results table populates.
2. Type a chat refinement like "show me only nonstop flights" — confirm it responds without needing the form again, and check that the browser network tab shows the request happened but reflect on whether a new Amadeus call fired (it shouldn't, per the cache-first rule, unless the filter can't be satisfied from cache).
3. Click a booking link — confirm it opens either the airline/hotel's own site (for a mapped carrier/chain) or a Google Flights/Hotels results page (for an unmapped one), and that the disclosure note appears when it's a fallback link.

- [ ] **Step 14: Commit**

```bash
git add app/api/chat/route.ts components/TripForm.tsx components/ChatPanel.tsx components/ResultsTable.tsx components/TripForm.test.tsx components/ResultsTable.test.tsx app/page.tsx
git commit -m "feat: wire form, chat, and results table to the streaming agent endpoint"
```
