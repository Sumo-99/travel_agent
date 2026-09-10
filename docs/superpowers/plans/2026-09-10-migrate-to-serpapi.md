# Migrate Data Source: Amadeus → SerpApi Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Amadeus flight/hotel data source (whose self-service portal was decommissioned 2026-07-17) with SerpApi's Google Flights and Google Hotels engines, without changing the `RawFlightOffer`/`RawHotelOffer`/`SearchFlightsToolArgs`/`SearchHotelsToolArgs` contracts the rest of the app (session store, orchestrator, UI) already depends on.

**Architecture:** This plan assumes the original plan (`docs/superpowers/plans/2026-09-10-travel-booking-agent.md`) has already been implemented in full — `types/travel.ts`, `lib/session/store.ts`, `lib/agent/orchestrator.ts`, `lib/links/*`, and the UI/API route all exist and pass their own tests. Because that plan's orchestrator used dependency injection (`AgentDependencies`) rather than importing `lib/amadeus/*` directly, this migration only needs to: (1) add two new optional fields to the shared `Raw*` offer types, (2) write new `lib/serpapi/*` modules that satisfy the exact same `searchFlights`/`searchHotels` signatures Amadeus's modules did, (3) teach the link builders to prefer a source-provided booking link when present, and (4) swap the two-line import in `app/api/chat/route.ts` and delete the retired Amadeus files. No changes to `lib/agent/orchestrator.ts`, `lib/session/store.ts`, or any UI component are needed.

**Tech Stack:** Same Next.js/TypeScript/Vitest stack as the original plan. New dependency: none required — SerpApi is called via plain `fetch` against `https://serpapi.com/search.json`, same pattern as the retired Amadeus `fetch`-based client.

**Spec:** `docs/superpowers/specs/2026-09-10-travel-booking-agent.md` (see its "Migration note" and updated "Stack" / "Known Data Limitation" / "Booking Links" sections — those sections now describe SerpApi, not Amadeus).

## Global Constraints

- The original plan's global constraints still apply in full (US-domestic-only, no payments, USD-only, in-memory session state, `nvidia/nemotron-3.5-lightning:free` via OpenRouter, no scraping tools in the price pipeline besides SerpApi itself which is a licensed data API, not ad-hoc scraping).
- Do not change the exported function signatures `searchFlights(args: SearchFlightsToolArgs): Promise<RawFlightOffer[]>` or `searchHotels(args: SearchHotelsToolArgs): Promise<RawHotelOffer[]>` — the orchestrator, session store, and tests written against the original plan depend on these exact shapes.
- New env var: `SERPAPI_API_KEY`. Retire `AMADEUS_CLIENT_ID`, `AMADEUS_CLIENT_SECRET`, `AMADEUS_BASE_URL` (delete from `.env.local.example`; the user updates their own `.env.local` manually).
- Every task that runs shell commands for build/test/install output **must** use the `context-mode` MCP tools (`ctx_batch_execute` / `ctx_execute`) instead of raw `Bash`, so raw output doesn't consume conversation context.
- Before writing code against SerpApi's response shapes, use the `context7` MCP (`resolve-library-id` then `query-docs`) to check for a `serpapi` npm package and its current TypeScript types; if `context7` has no coverage for it (SerpApi is a REST API, not always indexed as a library), fall back to `WebFetch`/`WebSearch` against SerpApi's own "Google Flights API" and "Google Hotels API" documentation pages to confirm current field names before finalizing field-mapping code — the field-mapping code in this plan is a best-effort based on SerpApi's documented shape as of this migration's authoring and **must be verified live**, the same way the original Amadeus task flagged the same risk for Amadeus's schema.
- Package manager: `npm`. Do not introduce new dependencies unless a step explicitly adds one.

---

## Subagent Plan Overview

4 subagent dispatches, in two phases. Phase 1 must complete and be reviewed before Phase 2 starts (Phase 2's two tasks both add files under `lib/serpapi/` and only depend on Phase 1's shared client + type changes, so they can run as two parallel subagents). Phase 3 is sequential after Phase 2.

| Phase | Task | Suggested model | Why |
|---|---|---|---|
| 1 | Task 1: SerpApi client + shared type additions | Sonnet 5 | Sets the contract (`serpApiGet`, extended `Raw*` types) both Phase 2 tasks build on. |
| 2 (parallel) | Task 2: SerpApi flight search (`lib/serpapi/flights.ts`) | Sonnet 5 | Real external API integration incl. the two-step booking-token lookup; correctness matters. |
| 2 (parallel) | Task 3: SerpApi hotel search (`lib/serpapi/hotels.ts`) | Sonnet 5 | Same reasoning as Task 2 — a real external API integration, independent file. |
| 3 | Task 4: Link-builder preference logic + wiring + retire Amadeus | Haiku | Mostly mechanical: reorder an if-check in two small files, swap two import lines, delete dead files. |

---

### Task 1: SerpApi Client + Shared Type Additions

**Files:**
- Create: `lib/serpapi/client.ts`
- Modify: `types/travel.ts` (add fields to `RawFlightOffer` and `RawHotelOffer`)
- Modify: `.env.local.example` (remove `AMADEUS_*`, add `SERPAPI_API_KEY`)
- Test: `lib/serpapi/client.test.ts`

**Interfaces:**
- Consumes: nothing new — `types/travel.ts` already exists from the original plan.
- Produces: `serpApiGet<T>(params: Record<string, string>): Promise<T>` from `lib/serpapi/client.ts`, used by Tasks 2 and 3.
- Produces: `RawFlightOffer` and `RawHotelOffer` each gain two new **optional** fields — `sourceBookingUrl?: string` and `sourceIsDirect?: boolean` — so existing code that constructs these types without the new fields (there shouldn't be any left after this migration, but any lingering test fixtures) still type-checks.

- [ ] **Step 1: Write the failing test for `serpApiGet`**

```ts
// lib/serpapi/client.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { serpApiGet } from "@/lib/serpapi/client";

describe("serpApiGet", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    process.env.SERPAPI_API_KEY = "test-key";
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("appends the api_key and returns parsed JSON on success", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ hello: "world" }),
    }) as unknown as typeof fetch;

    const result = await serpApiGet<{ hello: string }>({ engine: "google_flights" });

    expect(result).toEqual({ hello: "world" });
    const calledUrl = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(calledUrl).toContain("api_key=test-key");
    expect(calledUrl).toContain("engine=google_flights");
  });

  it("throws when SerpApi returns an error field", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ error: "Invalid API key" }),
    }) as unknown as typeof fetch;

    await expect(serpApiGet({ engine: "google_flights" })).rejects.toThrow("Invalid API key");
  });

  it("throws when the HTTP response is not ok", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => "server error",
    }) as unknown as typeof fetch;

    await expect(serpApiGet({ engine: "google_flights" })).rejects.toThrow("SerpApi request failed: 500");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run via `ctx_batch_execute`: `npx vitest run lib/serpapi/client.test.ts`
Expected: FAIL — `lib/serpapi/client.ts` does not exist yet.

- [ ] **Step 3: Implement `lib/serpapi/client.ts`**

```ts
const SERPAPI_BASE_URL = "https://serpapi.com/search.json";

interface SerpApiErrorShape {
  error?: string;
}

export async function serpApiGet<T>(params: Record<string, string>): Promise<T> {
  const query = new URLSearchParams({
    ...params,
    api_key: process.env.SERPAPI_API_KEY ?? "",
  }).toString();

  const res = await fetch(`${SERPAPI_BASE_URL}?${query}`);
  if (!res.ok) {
    throw new Error(`SerpApi request failed: ${res.status} ${await res.text()}`);
  }

  const data = (await res.json()) as T & SerpApiErrorShape;
  if (data.error) {
    throw new Error(data.error);
  }
  return data;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run via `ctx_batch_execute`: `npx vitest run lib/serpapi/client.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Add the new optional fields to the shared types**

In `types/travel.ts`, find the existing `RawFlightOffer` interface and add two fields at the end of it:

```ts
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
  sourceBookingUrl?: string;
  sourceIsDirect?: boolean;
}
```

And the existing `RawHotelOffer` interface:

```ts
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
  sourceBookingUrl?: string;
  sourceIsDirect?: boolean;
}
```

(`FlightOffer` and `HotelOffer` already `extends` these, so they inherit the new optional fields automatically — no change needed there.)

- [ ] **Step 6: Run the full test suite to confirm nothing broke**

Run via `ctx_batch_execute`: `npx vitest run`
Expected: PASS — adding optional fields must not break any existing test in `lib/agent/orchestrator.test.ts`, `lib/links/*.test.ts`, or `components/*.test.tsx` from the original plan.

- [ ] **Step 7: Update `.env.local.example`**

```
# .env.local.example
OPENROUTER_API_KEY=
SERPAPI_API_KEY=
```

(Remove the three `AMADEUS_*` lines this file previously had.)

- [ ] **Step 8: Commit**

```bash
git add lib/serpapi/client.ts lib/serpapi/client.test.ts types/travel.ts .env.local.example
git commit -m "feat: add SerpApi client and extend Raw offer types for source booking links"
```

---

### Task 2: SerpApi Flight Search

**Files:**
- Create: `lib/serpapi/flights.ts`
- Test: `lib/serpapi/flights.test.ts`

**Interfaces:**
- Consumes: `serpApiGet` from `lib/serpapi/client.ts` (Task 1). Consumes `RawFlightOffer`, `SearchFlightsToolArgs`, `CabinClass` from `types/travel.ts`.
- Produces: `searchFlights(args: SearchFlightsToolArgs): Promise<RawFlightOffer[]>` — **exact same signature** as the retired `lib/amadeus/flights.ts` export, so `app/api/chat/route.ts` only needs its import path changed (Task 4), not its call site.

Google Flights round-trip search via SerpApi is a two-step lookup: (1) the initial search returns itineraries each carrying a `booking_token`; (2) a follow-up request with that token returns the actual booking options (which provider, and whether it's the airline itself or an OTA). Verify both response shapes live against SerpApi's "Google Flights API" documentation via `context7`/`WebFetch` before finalizing field names — the shapes below are this plan's best-effort mapping and are the thing most likely to need a small field-name correction once you see a real response.

- [ ] **Step 1: Write the failing test for the happy path**

```ts
// lib/serpapi/flights.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import * as client from "@/lib/serpapi/client";
import { searchFlights } from "@/lib/serpapi/flights";

describe("searchFlights", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("normalizes a Google Flights search + booking-token lookup into RawFlightOffer[]", async () => {
    const spy = vi.spyOn(client, "serpApiGet");

    spy.mockImplementationOnce(async () => ({
      best_flights: [
        {
          flights: [
            {
              departure_airport: { id: "JFK", time: "2026-11-03 08:00" },
              arrival_airport: { id: "LAX", time: "2026-11-03 11:20" },
              airline: "Delta",
              flight_number: "DL 204",
            },
            {
              departure_airport: { id: "LAX", time: "2026-11-10 13:00" },
              arrival_airport: { id: "JFK", time: "2026-11-10 21:15" },
              airline: "Delta",
              flight_number: "DL 310",
            },
          ],
          total_duration: 380,
          price: 412,
          booking_token: "token-abc",
        },
      ],
    }));

    spy.mockImplementationOnce(async () => ({
      booking_options: [
        {
          together: {
            book_with: "Delta",
            booking_request: { url: "https://www.delta.com/booking/token-abc" },
          },
        },
      ],
    }));

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
      airline: "Delta",
      carrierCode: "DL",
      flightNumber: "DL 204",
      origin: "JFK",
      destination: "LAX",
      priceUSD: 412,
      cabinClass: "ECONOMY",
      sourceBookingUrl: "https://www.delta.com/booking/token-abc",
      sourceIsDirect: true,
    });
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("marks sourceIsDirect false when the booking option is an OTA, not the airline", async () => {
    const spy = vi.spyOn(client, "serpApiGet");
    spy.mockImplementationOnce(async () => ({
      best_flights: [
        {
          flights: [
            {
              departure_airport: { id: "JFK", time: "2026-11-03 08:00" },
              arrival_airport: { id: "LAX", time: "2026-11-03 11:20" },
              airline: "Frontier",
              flight_number: "F9 100",
            },
            {
              departure_airport: { id: "LAX", time: "2026-11-10 13:00" },
              arrival_airport: { id: "JFK", time: "2026-11-10 21:15" },
              airline: "Frontier",
              flight_number: "F9 200",
            },
          ],
          total_duration: 400,
          price: 220,
          booking_token: "token-xyz",
        },
      ],
    }));
    spy.mockImplementationOnce(async () => ({
      booking_options: [
        { together: { book_with: "Expedia", booking_request: { url: "https://expedia.com/x" } } },
      ],
    }));

    const offers = await searchFlights({
      origin: "JFK",
      destination: "LAX",
      departureDate: "2026-11-03",
      returnDate: "2026-11-10",
      travelers: 1,
      cabinClass: "ECONOMY",
    });

    expect(offers[0].sourceIsDirect).toBe(false);
    expect(offers[0].sourceBookingUrl).toBe("https://expedia.com/x");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run via `ctx_batch_execute`: `npx vitest run lib/serpapi/flights.test.ts`
Expected: FAIL — `lib/serpapi/flights.ts` does not exist yet.

- [ ] **Step 3: Implement `lib/serpapi/flights.ts`**

```ts
import { serpApiGet } from "@/lib/serpapi/client";
import type { RawFlightOffer, SearchFlightsToolArgs } from "@/types/travel";

interface SerpFlightSegment {
  departure_airport: { id: string; time: string };
  arrival_airport: { id: string; time: string };
  airline: string;
  flight_number: string; // e.g. "DL 204"
}

interface SerpFlightItinerary {
  flights: SerpFlightSegment[];
  total_duration: number; // minutes
  price: number;
  booking_token: string;
}

interface SerpFlightsSearchResponse {
  best_flights?: SerpFlightItinerary[];
  other_flights?: SerpFlightItinerary[];
}

interface SerpBookingOption {
  together?: {
    book_with: string;
    booking_request: { url: string };
  };
}

interface SerpBookingOptionsResponse {
  booking_options?: SerpBookingOption[];
}

const CABIN_CLASS_TO_TRAVEL_CLASS: Record<SearchFlightsToolArgs["cabinClass"], string> = {
  ECONOMY: "1",
  PREMIUM_ECONOMY: "2",
  BUSINESS: "3",
  FIRST: "4",
};

function splitCarrierCodeAndNumber(flightNumber: string): { carrierCode: string; number: string } {
  const [carrierCode, number] = flightNumber.split(" ");
  return { carrierCode: carrierCode ?? "", number: number ?? flightNumber };
}

function isDirectBooking(bookWith: string, airline: string): boolean {
  const normalizedBookWith = bookWith.trim().toLowerCase();
  const normalizedAirline = airline.trim().toLowerCase();
  return normalizedBookWith === normalizedAirline || normalizedAirline.includes(normalizedBookWith);
}

async function fetchBookingLink(
  bookingToken: string,
  args: SearchFlightsToolArgs,
  airline: string
): Promise<{ url?: string; isDirect?: boolean }> {
  const response = await serpApiGet<SerpBookingOptionsResponse>({
    engine: "google_flights",
    booking_token: bookingToken,
    departure_id: args.origin,
    arrival_id: args.destination,
    outbound_date: args.departureDate,
    return_date: args.returnDate,
    currency: "USD",
    hl: "en",
    gl: "us",
  });

  const option = response.booking_options?.[0]?.together;
  if (!option) return {};

  return {
    url: option.booking_request.url,
    isDirect: isDirectBooking(option.book_with, airline),
  };
}

export async function searchFlights(args: SearchFlightsToolArgs): Promise<RawFlightOffer[]> {
  const response = await serpApiGet<SerpFlightsSearchResponse>({
    engine: "google_flights",
    departure_id: args.origin,
    arrival_id: args.destination,
    outbound_date: args.departureDate,
    return_date: args.returnDate,
    adults: String(args.travelers),
    travel_class: CABIN_CLASS_TO_TRAVEL_CLASS[args.cabinClass],
    type: "1", // round trip
    currency: "USD",
    hl: "en",
    gl: "us",
  });

  const itineraries = [...(response.best_flights ?? []), ...(response.other_flights ?? [])].slice(
    0,
    args.maxResults ?? 10
  );

  const offers: RawFlightOffer[] = [];

  for (const itinerary of itineraries) {
    const outboundSegment = itinerary.flights[0];
    const lastOutboundIndex = Math.ceil(itinerary.flights.length / 2) - 1;
    const outboundLast = itinerary.flights[lastOutboundIndex];
    const inboundFirst = itinerary.flights[lastOutboundIndex + 1] ?? outboundLast;
    const inboundLast = itinerary.flights[itinerary.flights.length - 1];
    const { carrierCode, number } = splitCarrierCodeAndNumber(outboundSegment.flight_number);

    const bookingLink = await fetchBookingLink(itinerary.booking_token, args, outboundSegment.airline);

    offers.push({
      id: itinerary.booking_token,
      airline: outboundSegment.airline,
      carrierCode,
      flightNumber: number,
      origin: outboundSegment.departure_airport.id,
      destination: outboundLast.arrival_airport.id,
      departureDateTime: outboundSegment.departure_airport.time,
      arrivalDateTime: outboundLast.arrival_airport.time,
      returnDepartureDateTime: inboundFirst.departure_airport.time,
      returnArrivalDateTime: inboundLast.arrival_airport.time,
      stops: lastOutboundIndex,
      durationMinutes: itinerary.total_duration,
      priceUSD: itinerary.price,
      cabinClass: args.cabinClass,
      sourceBookingUrl: bookingLink.url,
      sourceIsDirect: bookingLink.isDirect,
    });
  }

  return offers;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run via `ctx_batch_execute`: `npx vitest run lib/serpapi/flights.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/serpapi/flights.ts lib/serpapi/flights.test.ts
git commit -m "feat: add SerpApi Google Flights integration replacing Amadeus flight search"
```

---

### Task 3: SerpApi Hotel Search

**Files:**
- Create: `lib/serpapi/hotels.ts`
- Test: `lib/serpapi/hotels.test.ts`

**Interfaces:**
- Consumes: `serpApiGet` from `lib/serpapi/client.ts` (Task 1). Consumes `RawHotelOffer`, `SearchHotelsToolArgs` from `types/travel.ts`.
- Produces: `searchHotels(args: SearchHotelsToolArgs): Promise<RawHotelOffer[]>` — **exact same signature** as the retired `lib/amadeus/hotels.ts` export.

Google Hotels (via SerpApi) is queried with a free-text location string, not an IATA city code. `SearchHotelsToolArgs.cityCode` keeps its existing field name (the orchestrator's tool schema from the original plan already asks the LLM for this field and must not be renamed), but this task treats its value as a place-ish string and appends "hotels" to form the query — e.g. `cityCode: "LAX"` becomes the query `"LAX hotels"`. This is a known accuracy limitation (an airport code isn't always the ideal hotel-search query) — leave a comment noting it rather than building a full IATA-to-city-name lookup table, which is out of scope for this migration.

- [ ] **Step 1: Write the failing test for `searchHotels`**

```ts
// lib/serpapi/hotels.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import * as client from "@/lib/serpapi/client";
import { searchHotels } from "@/lib/serpapi/hotels";

describe("searchHotels", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("normalizes a Google Hotels response into RawHotelOffer[], marking OTA links as non-direct", async () => {
    vi.spyOn(client, "serpApiGet").mockResolvedValue({
      properties: [
        {
          name: "Downtown LA Hotel",
          property_token: "prop-1",
          link: "https://www.hilton.com/en/hotels/downtown-la",
          hotel_class: "4-star hotel",
          rate_per_night: { extracted_lowest: 88.57 },
          total_rate: { extracted_lowest: 620 },
        },
        {
          name: "The Corner Inn",
          property_token: "prop-2",
          link: "https://www.booking.com/hotel/us/the-corner-inn.html",
          rate_per_night: { extracted_lowest: 60 },
          total_rate: { extracted_lowest: 420 },
        },
      ],
    });

    const offers = await searchHotels({
      cityCode: "LAX",
      checkInDate: "2026-11-03",
      checkOutDate: "2026-11-10",
      travelers: 1,
    });

    expect(offers).toHaveLength(2);
    expect(offers[0]).toMatchObject({
      id: "prop-1",
      name: "Downtown LA Hotel",
      starRating: 4,
      cityCode: "LAX",
      pricePerNightUSD: 88.57,
      totalPriceUSD: 620,
      sourceBookingUrl: "https://www.hilton.com/en/hotels/downtown-la",
      sourceIsDirect: true,
    });
    expect(offers[1]).toMatchObject({
      sourceBookingUrl: "https://www.booking.com/hotel/us/the-corner-inn.html",
      sourceIsDirect: false,
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run via `ctx_batch_execute`: `npx vitest run lib/serpapi/hotels.test.ts`
Expected: FAIL — `lib/serpapi/hotels.ts` does not exist yet.

- [ ] **Step 3: Implement `lib/serpapi/hotels.ts`**

```ts
import { serpApiGet } from "@/lib/serpapi/client";
import type { RawHotelOffer, SearchHotelsToolArgs } from "@/types/travel";

interface SerpHotelProperty {
  name: string;
  property_token: string;
  link?: string;
  hotel_class?: string; // e.g. "4-star hotel"
  rate_per_night?: { extracted_lowest?: number };
  total_rate?: { extracted_lowest?: number };
}

interface SerpHotelsResponse {
  properties?: SerpHotelProperty[];
}

const OTA_DOMAINS = ["booking.com", "expedia.com", "hotels.com", "agoda.com", "trip.com", "priceline.com"];

function isDirectHotelLink(url: string | undefined): boolean {
  if (!url) return false;
  return !OTA_DOMAINS.some((domain) => url.includes(domain));
}

function parseStarRating(hotelClass: string | undefined): number | null {
  const match = hotelClass ? /(\d+)/.exec(hotelClass) : null;
  return match ? Number(match[1]) : null;
}

export async function searchHotels(args: SearchHotelsToolArgs): Promise<RawHotelOffer[]> {
  // NOTE: cityCode is treated as a free-text location hint, not a strict
  // IATA lookup — Google Hotels takes a natural-language query. This is an
  // accepted accuracy tradeoff for this migration (see Task 3 notes in the
  // migration plan); a proper IATA-to-city-name map is a future improvement.
  const response = await serpApiGet<SerpHotelsResponse>({
    engine: "google_hotels",
    q: `${args.cityCode} hotels`,
    check_in_date: args.checkInDate,
    check_out_date: args.checkOutDate,
    adults: String(args.travelers),
    currency: "USD",
    hl: "en",
    gl: "us",
  });

  const properties = (response.properties ?? []).slice(0, args.maxResults ?? 10);

  return properties.map((property) => {
    const pricePerNightUSD = property.rate_per_night?.extracted_lowest ?? 0;
    const totalPriceUSD = property.total_rate?.extracted_lowest ?? pricePerNightUSD;

    return {
      id: property.property_token,
      name: property.name,
      chainCode: null,
      starRating: parseStarRating(property.hotel_class),
      address: "",
      cityCode: args.cityCode,
      checkInDate: args.checkInDate,
      checkOutDate: args.checkOutDate,
      pricePerNightUSD,
      totalPriceUSD,
      sourceBookingUrl: property.link,
      sourceIsDirect: isDirectHotelLink(property.link),
    };
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run via `ctx_batch_execute`: `npx vitest run lib/serpapi/hotels.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/serpapi/hotels.ts lib/serpapi/hotels.test.ts
git commit -m "feat: add SerpApi Google Hotels integration replacing Amadeus hotel search"
```

---

### Task 4: Link-Builder Preference Logic, Wiring, and Amadeus Retirement

**Files:**
- Modify: `lib/links/flightLink.ts`
- Modify: `lib/links/hotelLink.ts`
- Modify: `app/api/chat/route.ts`
- Delete: `lib/amadeus/client.ts`, `lib/amadeus/flights.ts`, `lib/amadeus/hotels.ts`, `lib/amadeus/flights.test.ts`, `lib/amadeus/hotels.test.ts`
- Test: `lib/links/flightLink.test.ts` (extend existing file), `lib/links/hotelLink.test.ts` (extend existing file)

**Interfaces:**
- Consumes: `searchFlights` from `lib/serpapi/flights.ts` (Task 2), `searchHotels` from `lib/serpapi/hotels.ts` (Task 3), `RawFlightOffer`/`RawHotelOffer` (now carrying `sourceBookingUrl`/`sourceIsDirect`) from `types/travel.ts` (Task 1).
- Produces: no new exports — `buildFlightLink`/`buildHotelLink` keep their existing signatures from the original plan; only their internal logic changes.

- [ ] **Step 1: Add a failing test for the new "prefer source link" behavior to `lib/links/flightLink.test.ts`**

Add this test alongside the two tests already in that file from the original plan:

```ts
it("prefers a direct sourceBookingUrl over the carrier map when present", () => {
  const link = buildFlightLink({ ...baseOffer, sourceBookingUrl: "https://real-airline-link.example.com", sourceIsDirect: true });
  expect(link.url).toBe("https://real-airline-link.example.com");
  expect(link.isDirect).toBe(true);
  expect(link.note).toBe("");
});

it("prefers a non-direct sourceBookingUrl over the carrier map, with an explanatory note", () => {
  const link = buildFlightLink({ ...baseOffer, sourceBookingUrl: "https://expedia.example.com/x", sourceIsDirect: false });
  expect(link.url).toBe("https://expedia.example.com/x");
  expect(link.isDirect).toBe(false);
  expect(link.note).toContain(baseOffer.airline);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run via `ctx_batch_execute`: `npx vitest run lib/links/flightLink.test.ts`
Expected: FAIL — `buildFlightLink` doesn't yet look at `sourceBookingUrl`, so the first new test gets the carrier-map link (`delta.com`) instead of the asserted `real-airline-link.example.com`.

- [ ] **Step 3: Update `lib/links/flightLink.ts`**

```ts
import { CARRIER_LINK_TEMPLATES, buildGoogleFlightsUrl } from "@/lib/links/carrierMap";
import type { BookingLink, RawFlightOffer } from "@/types/travel";

export function buildFlightLink(offer: RawFlightOffer): BookingLink {
  if (offer.sourceBookingUrl) {
    return {
      url: offer.sourceBookingUrl,
      isDirect: Boolean(offer.sourceIsDirect),
      note: offer.sourceIsDirect
        ? ""
        : `Showing the best available booking option found for ${offer.airline} — not necessarily their own site.`,
    };
  }

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

- [ ] **Step 4: Run test to verify it passes**

Run via `ctx_batch_execute`: `npx vitest run lib/links/flightLink.test.ts`
Expected: PASS (all 4 tests — the 2 original plus the 2 new ones)

- [ ] **Step 5: Add a failing test for the same behavior to `lib/links/hotelLink.test.ts`**

```ts
it("prefers a direct sourceBookingUrl over the chain map when present", () => {
  const link = buildHotelLink({ ...baseOffer, sourceBookingUrl: "https://real-hotel-link.example.com", sourceIsDirect: true });
  expect(link.url).toBe("https://real-hotel-link.example.com");
  expect(link.isDirect).toBe(true);
  expect(link.note).toBe("");
});

it("prefers a non-direct sourceBookingUrl over the chain map, with an explanatory note", () => {
  const link = buildHotelLink({ ...baseOffer, sourceBookingUrl: "https://booking.example.com/x", sourceIsDirect: false });
  expect(link.url).toBe("https://booking.example.com/x");
  expect(link.isDirect).toBe(false);
  expect(link.note).toContain(baseOffer.name);
});
```

- [ ] **Step 6: Run test to verify it fails**

Run via `ctx_batch_execute`: `npx vitest run lib/links/hotelLink.test.ts`
Expected: FAIL for the same reason as Step 2.

- [ ] **Step 7: Update `lib/links/hotelLink.ts`**

```ts
import { HOTEL_CHAIN_LINK_TEMPLATES, buildGoogleHotelsUrl } from "@/lib/links/carrierMap";
import type { BookingLink, RawHotelOffer } from "@/types/travel";

export function buildHotelLink(offer: RawHotelOffer): BookingLink {
  if (offer.sourceBookingUrl) {
    return {
      url: offer.sourceBookingUrl,
      isDirect: Boolean(offer.sourceIsDirect),
      note: offer.sourceIsDirect
        ? ""
        : `Showing the best available booking option found for ${offer.name} — not necessarily their own site.`,
    };
  }

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

- [ ] **Step 8: Run test to verify it passes**

Run via `ctx_batch_execute`: `npx vitest run lib/links/hotelLink.test.ts`
Expected: PASS

- [ ] **Step 9: Swap the import in `app/api/chat/route.ts`**

Change:

```ts
import { searchFlights } from "@/lib/amadeus/flights";
import { searchHotels } from "@/lib/amadeus/hotels";
```

to:

```ts
import { searchFlights } from "@/lib/serpapi/flights";
import { searchHotels } from "@/lib/serpapi/hotels";
```

No other line in this file changes — `createOrchestrator({ searchFlights, searchHotels, buildFlightLink, buildHotelLink })` already takes these as injected dependencies by name, so the call site is untouched.

- [ ] **Step 10: Delete the retired Amadeus files**

```bash
git rm lib/amadeus/client.ts lib/amadeus/flights.ts lib/amadeus/hotels.ts lib/amadeus/flights.test.ts lib/amadeus/hotels.test.ts
```

- [ ] **Step 11: Run the full test suite and build**

Run via `ctx_batch_execute`: `npx vitest run` (expect all passing, with zero references left to `lib/amadeus/*`), then `npm run build` (expect success — this also catches any leftover import of the deleted Amadeus modules).

- [ ] **Step 12: Manual end-to-end check**

Add a real `SERPAPI_API_KEY` to `.env.local`, run `npm run dev`, and repeat the same manual check from the original plan's Task 5 Step 13 (submit the form, confirm results populate, try a chat refinement, click a booking link). Additionally confirm: at least one flight or hotel result in a real search shows `isDirect: false` behavior in the UI (a "View options" label plus the explanatory note) so you've exercised both branches of the new preference logic, not just the direct-link happy path.

- [ ] **Step 13: Commit**

```bash
git add lib/links/flightLink.ts lib/links/hotelLink.ts lib/links/flightLink.test.ts lib/links/hotelLink.test.ts app/api/chat/route.ts
git commit -m "feat: prefer SerpApi-provided booking links and retire Amadeus integration"
```
