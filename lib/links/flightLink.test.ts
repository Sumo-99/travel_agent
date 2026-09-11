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
  it("prefers a direct source booking link", () => {
    const link = buildFlightLink({
      ...baseOffer,
      sourceBookingUrl: "https://www.delta.com/booking/source-token",
      sourceIsDirect: true,
    });

    expect(link).toEqual({
      url: "https://www.delta.com/booking/source-token",
      isDirect: true,
      note: "",
    });
  });

  it("preserves a non-direct source booking link with an airline note", () => {
    const link = buildFlightLink({
      ...baseOffer,
      sourceBookingUrl: "https://www.expedia.com/flight/source-token",
      sourceIsDirect: false,
    });

    expect(link.url).toBe("https://www.expedia.com/flight/source-token");
    expect(link.isDirect).toBe(false);
    expect(link.note).toContain("Delta Air Lines");
  });

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
