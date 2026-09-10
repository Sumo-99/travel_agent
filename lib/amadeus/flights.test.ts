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
