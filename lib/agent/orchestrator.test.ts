import { describe, it, expect, vi, beforeEach } from "vitest";
import { createOrchestrator, type AgentDependencies } from "@/lib/agent/orchestrator";
import type { RawFlightOffer, RawHotelOffer, SessionState } from "@/types/travel";

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

const sampleHotelRaw: RawHotelOffer = {
  id: "h1",
  name: "Grand Plaza",
  chainCode: "HY",
  starRating: 4,
  address: "123 Main St",
  cityCode: "LAX",
  checkInDate: "2026-11-03",
  checkOutDate: "2026-11-10",
  pricePerNightUSD: 180,
  totalPriceUSD: 1260,
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

  it("falls through to a fresh search when the cached results do not satisfy the filter", async () => {
    const session = freshSession();
    session.lastFlightSearchParams = {
      origin: "JFK",
      destination: "LAX",
      departureDate: "2026-11-03",
      returnDate: "2026-11-10",
      travelers: 1,
      cabinClass: "ECONOMY",
    };
    session.lastFlightResults = [
      { ...sampleRaw, id: "expensive", priceUSD: 900, bookingLink: { url: "x", isDirect: true, note: "" } },
    ];

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

    expect(deps.searchFlights).toHaveBeenCalledTimes(1);
    expect(result.map((r) => r.id)).toEqual(["1"]);
    // the merged cache still holds both offers, only the returned view is filtered
    expect(session.lastFlightResults).toHaveLength(2);
  });

  it("attaches booking links and caches hotel results on a fresh hotel search", async () => {
    deps.searchHotels = vi.fn(async () => [sampleHotelRaw]);
    const session = freshSession();

    const orchestrator = createOrchestrator(deps);
    const result = await orchestrator.__internal.runHotelSearch(
      {
        cityCode: "LAX",
        checkInDate: "2026-11-03",
        checkOutDate: "2026-11-10",
        travelers: 1,
      },
      session
    );

    expect(deps.searchHotels).toHaveBeenCalledTimes(1);
    expect(result).toHaveLength(1);
    expect(result[0].bookingLink.url).toBe("https://example.com");
    expect(session.lastHotelResults).toHaveLength(1);
  });

  it("reuses cached hotels when dates match and a tighter filter is requested", async () => {
    deps.searchHotels = vi.fn(async () => [sampleHotelRaw]);
    const session = freshSession();
    session.lastHotelResults = [
      { ...sampleHotelRaw, bookingLink: { url: "x", isDirect: true, note: "" } },
      {
        ...sampleHotelRaw,
        id: "h2",
        name: "Budget Inn",
        starRating: 2,
        pricePerNightUSD: 400,
        bookingLink: { url: "y", isDirect: false, note: "" },
      },
    ];

    const orchestrator = createOrchestrator(deps);
    const result = await orchestrator.__internal.runHotelSearch(
      {
        cityCode: "LAX",
        checkInDate: "2026-11-03",
        checkOutDate: "2026-11-10",
        travelers: 1,
        maxPricePerNightUSD: 200,
        minStarRating: 3,
      },
      session
    );

    expect(deps.searchHotels).not.toHaveBeenCalled();
    expect(result.map((h) => h.id)).toEqual(["h1"]);
  });
});
