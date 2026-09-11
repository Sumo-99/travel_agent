import { beforeEach, describe, expect, it, vi } from "vitest";
import * as client from "@/lib/serpapi/client";
import { searchFlights } from "@/lib/serpapi/flights";

describe("searchFlights", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("retrieves the return leg with departure_token, then resolves booking options", async () => {
    const spy = vi.spyOn(client, "serpApiGet");

    spy.mockImplementationOnce(async (params) => {
      expect(params).toEqual({
        engine: "google_flights",
        departure_id: "JFK",
        arrival_id: "LAX",
        outbound_date: "2026-11-03",
        return_date: "2026-11-10",
        adults: "1",
        travel_class: "1",
        type: "1",
        currency: "USD",
        hl: "en",
        gl: "us",
      });

      return {
        best_flights: [
          {
            flights: [{
              departure_airport: { id: "JFK", time: "2026-11-03 08:00" },
              arrival_airport: { id: "LAX", time: "2026-11-03 11:20" },
              airline: "Delta",
              flight_number: "DL 204",
              duration: 380,
            }],
            total_duration: 380,
            departure_token: "departure-token-abc",
          },
        ],
      };
    });

    spy.mockImplementationOnce(async (params) => {
      expect(params).toEqual({
        engine: "google_flights",
        departure_token: "departure-token-abc",
        currency: "USD",
        hl: "en",
        gl: "us",
      });

      return {
        best_flights: [{
          flights: [{
            departure_airport: { id: "LAX", time: "2026-11-10 13:00" },
            arrival_airport: { id: "JFK", time: "2026-11-10 21:15" },
            airline: "Delta",
            flight_number: "DL 310",
            duration: 315,
          }],
          total_duration: 315,
          price: 412,
          booking_token: "booking-token-abc",
        }],
      };
    });

    spy.mockImplementationOnce(async (params) => {
      expect(params).toEqual({
        engine: "google_flights",
        booking_token: "booking-token-abc",
        currency: "USD",
        hl: "en",
        gl: "us",
      });

      return {
        booking_options: [{
          together: {
            book_with: "Delta",
            airline: true,
            booking_request: { url: "https://www.delta.com/booking/token-abc" },
          },
        }],
      };
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
      airline: "Delta",
      carrierCode: "DL",
      flightNumber: "204",
      origin: "JFK",
      destination: "LAX",
      departureDateTime: "2026-11-03 08:00",
      arrivalDateTime: "2026-11-03 11:20",
      returnDepartureDateTime: "2026-11-10 13:00",
      returnArrivalDateTime: "2026-11-10 21:15",
      stops: 0,
      durationMinutes: 695,
      priceUSD: 412,
      cabinClass: "ECONOMY",
      sourceBookingUrl: "https://www.delta.com/booking/token-abc",
      sourceIsDirect: true,
    });
    expect(spy).toHaveBeenCalledTimes(3);
  });

  it("marks sourceIsDirect false when the booking option is an OTA, not the airline", async () => {
    const spy = vi.spyOn(client, "serpApiGet");

    spy.mockImplementationOnce(async () => ({
      best_flights: [{
        flights: [{
          departure_airport: { id: "JFK", time: "2026-11-03 08:00" },
          arrival_airport: { id: "LAX", time: "2026-11-03 11:20" },
          airline: "Frontier",
          flight_number: "F9 100",
          duration: 320,
        }],
        total_duration: 320,
        departure_token: "departure-token-xyz",
      }],
    }));
    spy.mockImplementationOnce(async () => ({
      best_flights: [{
        flights: [{
          departure_airport: { id: "LAX", time: "2026-11-10 13:00" },
          arrival_airport: { id: "JFK", time: "2026-11-10 21:15" },
          airline: "Frontier",
          flight_number: "F9 200",
          duration: 375,
        }],
        total_duration: 375,
        price: 220,
        booking_token: "booking-token-xyz",
      }],
    }));
    spy.mockImplementationOnce(async () => ({
      booking_options: [{
        together: {
          book_with: "Expedia",
          airline: false,
          booking_request: { url: "https://expedia.com/x" },
        },
      }],
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
    expect(spy).toHaveBeenCalledTimes(3);
  });

  it("skips incomplete, zero-priced, or tokenless return options and respects maxResults", async () => {
    const spy = vi.spyOn(client, "serpApiGet");
    spy.mockResolvedValueOnce({
      other_flights: [{
        flights: [{
          departure_airport: { id: "JFK", time: "2026-11-03 08:00" },
          arrival_airport: { id: "LAX", time: "2026-11-03 11:20" },
          airline: "Delta",
          flight_number: "DL 204",
          duration: 380,
        }],
        total_duration: 380,
        departure_token: "departure-token",
      }],
    });
    spy.mockResolvedValueOnce({
      other_flights: [
        { flights: [], total_duration: 0, price: 100 },
        {
          flights: [{
            departure_airport: { id: "LAX", time: "2026-11-10 13:00" },
            arrival_airport: { id: "JFK", time: "2026-11-10 21:15" },
            airline: "Delta",
            flight_number: "DL 310",
            duration: 315,
          }],
          total_duration: 315,
          price: 315,
          // A positive price is not enough to emit an offer without this token.
        },
      ],
    });

    const offers = await searchFlights({
      origin: "JFK",
      destination: "LAX",
      departureDate: "2026-11-03",
      returnDate: "2026-11-10",
      travelers: 1,
      cabinClass: "ECONOMY",
      maxResults: 1,
    });

    expect(offers).toEqual([]);
    expect(spy).toHaveBeenCalledTimes(2);
  });
});
