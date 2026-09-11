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
        booking_options: [
          { together: { book_with: "Unavailable", booking_request: {} } },
          {
            together: {
              book_with: "Delta",
              airline: true,
              booking_request: { url: "https://www.delta.com/booking/token-abc" },
            },
          },
        ],
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

  it("skips malformed outbound and return options without throwing", async () => {
    const spy = vi.spyOn(client, "serpApiGet");
    spy.mockResolvedValueOnce({
      best_flights: [
        {},
        { flights: [{ departure_airport: {}, arrival_airport: {}, flight_number: "" }] },
        {
          flights: [{
            departure_airport: { id: "JFK", time: "2026-11-03 08:00" },
            arrival_airport: { id: "LAX", time: "2026-11-03 11:20" },
            airline: "Delta",
            flight_number: "DL 204",
          }],
          total_duration: 380,
          departure_token: "departure-token-valid",
        },
      ],
    });
    spy.mockResolvedValueOnce({
      other_flights: [
        {},
        {
          flights: [{ departure_airport: {}, arrival_airport: {}, flight_number: "DL 310" }],
          total_duration: 315,
          price: 412,
          booking_token: "booking-token-valid",
        },
        {
          flights: [{
            departure_airport: { id: "LAX", time: "2026-11-10 13:00" },
            arrival_airport: { id: "JFK", time: "2026-11-10 21:15" },
            airline: "Delta",
            flight_number: "DL 310",
          }],
          total_duration: 315,
          price: 412,
          booking_token: "booking-token-valid-2",
        },
      ],
    });
    spy.mockResolvedValueOnce({ booking_options: [] });
    spy.mockResolvedValueOnce({ booking_options: [] });

    const offers = await searchFlights({
      origin: "JFK",
      destination: "LAX",
      departureDate: "2026-11-03",
      returnDate: "2026-11-10",
      travelers: 1,
      cabinClass: "ECONOMY",
    });

    expect(offers).toHaveLength(1);
    expect(offers[0].id).toBe("booking-token-valid-2");
  });

  it("does not let malformed outbound options consume maxResults", async () => {
    const spy = vi.spyOn(client, "serpApiGet");
    spy.mockResolvedValueOnce({
      best_flights: [
        {},
        {
          flights: [{
            departure_airport: { id: " JFK ", time: "2026-11-03 08:00" },
            arrival_airport: { id: " LAX ", time: "2026-11-03 11:20" },
            airline: " Delta ",
            flight_number: " DL   204 ",
          }],
          total_duration: 380,
          departure_token: " departure-token-trimmed ",
        },
      ],
    });
    spy.mockResolvedValueOnce({
      best_flights: [{
        flights: [{
          departure_airport: { id: " LAX ", time: "2026-11-10 13:00" },
          arrival_airport: { id: " JFK ", time: "2026-11-10 21:15" },
          airline: "Delta",
          flight_number: "DL 310",
        }],
        total_duration: 315,
        price: 412,
        booking_token: " booking-token-trimmed ",
      }],
    });
    spy.mockResolvedValueOnce({
      booking_options: [{
        together: { booking_request: { url: " https://delta.com/booking " } },
      }],
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

    expect(offers).toHaveLength(1);
    expect(offers[0]).toMatchObject({
      id: "booking-token-trimmed",
      carrierCode: "DL",
      flightNumber: "204",
      airline: "Delta",
      origin: "JFK",
      destination: "LAX",
      sourceBookingUrl: "https://delta.com/booking",
    });
    expect(spy).toHaveBeenCalledTimes(3);
    expect(spy.mock.calls[1][0]).toMatchObject({ departure_token: "departure-token-trimmed" });
    expect(spy.mock.calls[2][0]).toMatchObject({ booking_token: "booking-token-trimmed" });
  });

  it("skips null, non-object, and malformed top-level responses without throwing", async () => {
    const spy = vi.spyOn(client, "serpApiGet");
    spy.mockResolvedValueOnce(null);

    await expect(searchFlights({
      origin: "JFK",
      destination: "LAX",
      departureDate: "2026-11-03",
      returnDate: "2026-11-10",
      travelers: 1,
      cabinClass: "ECONOMY",
    })).resolves.toEqual([]);

    spy.mockResolvedValueOnce("malformed");

    await expect(searchFlights({
      origin: "JFK",
      destination: "LAX",
      departureDate: "2026-11-03",
      returnDate: "2026-11-10",
      travelers: 1,
      cabinClass: "ECONOMY",
    })).resolves.toEqual([]);

    spy.mockResolvedValueOnce({ best_flights: {}, other_flights: null });

    await expect(searchFlights({
      origin: "JFK",
      destination: "LAX",
      departureDate: "2026-11-03",
      returnDate: "2026-11-10",
      travelers: 1,
      cabinClass: "ECONOMY",
    })).resolves.toEqual([]);

    spy.mockResolvedValueOnce({
      best_flights: [{
        flights: [{
          departure_airport: { id: "JFK", time: "2026-11-03 08:00" },
          arrival_airport: { id: "LAX", time: "2026-11-03 11:20" },
          airline: "Delta",
          flight_number: "DL 204",
        }],
        total_duration: 380,
        departure_token: "departure-token-malformed-return",
      }],
    });
    spy.mockResolvedValueOnce(null);

    await expect(searchFlights({
      origin: "JFK",
      destination: "LAX",
      departureDate: "2026-11-03",
      returnDate: "2026-11-10",
      travelers: 1,
      cabinClass: "ECONOMY",
    })).resolves.toEqual([]);

    spy.mockResolvedValueOnce({
      best_flights: [{
        flights: [{
          departure_airport: { id: "JFK", time: "2026-11-03 08:00" },
          arrival_airport: { id: "LAX", time: "2026-11-03 11:20" },
          airline: "Delta",
          flight_number: "DL 204",
        }],
        total_duration: 380,
        departure_token: "departure-token-malformed-fields",
      }],
    });
    spy.mockResolvedValueOnce({ best_flights: {}, other_flights: "malformed" });

    await expect(searchFlights({
      origin: "JFK",
      destination: "LAX",
      departureDate: "2026-11-03",
      returnDate: "2026-11-10",
      travelers: 1,
      cabinClass: "ECONOMY",
    })).resolves.toEqual([]);

    spy.mockResolvedValueOnce({
      best_flights: [{
        flights: [{
          departure_airport: { id: "JFK", time: "2026-11-03 08:00" },
          arrival_airport: { id: "LAX", time: "2026-11-03 11:20" },
          airline: "Delta",
          flight_number: "DL 204",
        }],
        total_duration: 380,
        departure_token: "departure-token-malformed-booking-options",
      }],
    });
    spy.mockResolvedValueOnce({
      best_flights: [{
        flights: [{
          departure_airport: { id: "LAX", time: "2026-11-10 13:00" },
          arrival_airport: { id: "JFK", time: "2026-11-10 21:15" },
          airline: "Delta",
          flight_number: "DL 310",
        }],
        total_duration: 315,
        price: 412,
        booking_token: "booking-token-malformed-options",
      }],
    });
    spy.mockResolvedValueOnce({ booking_options: {} });

    const offers = await searchFlights({
      origin: "JFK",
      destination: "LAX",
      departureDate: "2026-11-03",
      returnDate: "2026-11-10",
      travelers: 1,
      cabinClass: "ECONOMY",
    });

    expect(offers).toHaveLength(1);
    expect(offers[0].sourceBookingUrl).toBeUndefined();
  });

  it("truncates multiple valid normalized offers at maxResults", async () => {
    const spy = vi.spyOn(client, "serpApiGet");
    spy.mockResolvedValueOnce({
      best_flights: [{
        flights: [{
          departure_airport: { id: "JFK", time: "2026-11-03 08:00" },
          arrival_airport: { id: "LAX", time: "2026-11-03 11:20" },
          airline: "Delta",
          flight_number: "DL 204",
        }],
        total_duration: 380,
        departure_token: "departure-token-max-results",
      }],
    });
    spy.mockResolvedValueOnce({
      best_flights: ["malformed", ...["one", "two", "three"].map((suffix, index) => ({
        flights: [{
          departure_airport: { id: "LAX", time: `2026-11-10 13:0${index}` },
          arrival_airport: { id: "JFK", time: "2026-11-10 21:15" },
          airline: "Delta",
          flight_number: `DL ${310 + index}`,
        }],
        total_duration: 315,
        price: 400 + index,
        booking_token: `booking-token-${suffix}`,
      }))],
    });
    spy.mockResolvedValueOnce({ booking_options: [] });
    spy.mockResolvedValueOnce({ booking_options: [] });

    const offers = await searchFlights({
      origin: "JFK",
      destination: "LAX",
      departureDate: "2026-11-03",
      returnDate: "2026-11-10",
      travelers: 1,
      cabinClass: "ECONOMY",
      maxResults: 2,
    });

    expect(offers.map((offer) => offer.id)).toEqual([
      "booking-token-one",
      "booking-token-two",
    ]);
    expect(spy).toHaveBeenCalledTimes(4);
  });

  it("skips zero, negative, and non-finite prices", async () => {
    const spy = vi.spyOn(client, "serpApiGet");
    spy.mockResolvedValueOnce({
      best_flights: [{
        flights: [{
          departure_airport: { id: "JFK", time: "2026-11-03 08:00" },
          arrival_airport: { id: "LAX", time: "2026-11-03 11:20" },
          airline: "Delta",
          flight_number: "DL 204",
        }],
        total_duration: 380,
        departure_token: "departure-token-price",
      }],
    });
    spy.mockResolvedValueOnce({
      best_flights: [0, -1, Number.NaN, Number.POSITIVE_INFINITY, 412].map((price, index) => ({
        flights: [{
          departure_airport: { id: "LAX", time: `2026-11-10 13:0${index}` },
          arrival_airport: { id: "JFK", time: "2026-11-10 21:15" },
          airline: "Delta",
          flight_number: "DL 310",
        }],
        total_duration: 315,
        price,
        booking_token: `booking-token-price-${index}`,
      })),
    });
    spy.mockResolvedValueOnce({ booking_options: [] });

    const offers = await searchFlights({
      origin: "JFK",
      destination: "LAX",
      departureDate: "2026-11-03",
      returnDate: "2026-11-10",
      travelers: 1,
      cabinClass: "ECONOMY",
    });

    expect(offers).toHaveLength(1);
    expect(offers[0].priceUSD).toBe(412);
  });

  it("skips duplicate return booking tokens within one search", async () => {
    const spy = vi.spyOn(client, "serpApiGet");
    spy.mockResolvedValueOnce({
      best_flights: [{
        flights: [{
          departure_airport: { id: "JFK", time: "2026-11-03 08:00" },
          arrival_airport: { id: "LAX", time: "2026-11-03 11:20" },
          airline: "Delta",
          flight_number: "DL 204",
        }],
        total_duration: 380,
        departure_token: "departure-token-duplicate",
      }],
    });
    spy.mockResolvedValueOnce({
      best_flights: [
        {
          flights: [{
            departure_airport: { id: "LAX", time: "2026-11-10 13:00" },
            arrival_airport: { id: "JFK", time: "2026-11-10 21:15" },
            airline: "Delta",
            flight_number: "DL 310",
          }],
          total_duration: 315,
          price: 412,
          booking_token: "booking-token-duplicate",
        },
        {
          flights: [{
            departure_airport: { id: "LAX", time: "2026-11-10 14:00" },
            arrival_airport: { id: "JFK", time: "2026-11-10 22:15" },
            airline: "Delta",
            flight_number: "DL 311",
          }],
          total_duration: 375,
          price: 450,
          booking_token: "booking-token-duplicate",
        },
      ],
    });
    spy.mockResolvedValueOnce({ booking_options: [] });

    const offers = await searchFlights({
      origin: "JFK",
      destination: "LAX",
      departureDate: "2026-11-03",
      returnDate: "2026-11-10",
      travelers: 1,
      cabinClass: "ECONOMY",
    });

    expect(offers).toHaveLength(1);
    expect(offers[0].id).toBe("booking-token-duplicate");
    expect(spy).toHaveBeenCalledTimes(3);
  });
});
