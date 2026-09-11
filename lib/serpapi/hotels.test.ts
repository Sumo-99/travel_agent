import { beforeEach, describe, expect, it, vi } from "vitest";
import * as client from "@/lib/serpapi/client";
import { searchHotels } from "@/lib/serpapi/hotels";

describe("searchHotels", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("queries Google Hotels and normalizes direct and OTA properties", async () => {
    const spy = vi.spyOn(client, "serpApiGet").mockImplementation(async (params) => {
      expect(params).toEqual({
        engine: "google_hotels",
        q: "Los Angeles hotels",
        check_in_date: "2026-11-03",
        check_out_date: "2026-11-10",
        adults: "2",
        currency: "USD",
        hl: "en",
        gl: "us",
      });

      return {
        properties: [
          {
            property_token: "direct-token",
            name: "Downtown LA Hotel",
            extracted_hotel_class: 4,
            hotel_class: "4-star hotel",
            address: "123 Main St, Los Angeles, CA",
            link: "https://www.downtownlahotel.com/book",
            rate_per_night: { extracted_lowest: 180 },
            total_rate: { extracted_lowest: 1260 },
          },
          {
            property_token: "ota-token",
            name: "Beachside Inn",
            hotel_class: "3-star hotel",
            address: "456 Ocean Ave, Los Angeles, CA",
            link: "https://www.booking.com/hotel/us/beachside.html",
            rate_per_night: { extracted_lowest: 150 },
            total_rate: { extracted_lowest: 1050 },
          },
        ],
      };
    });

    const offers = await searchHotels({
      cityCode: "Los Angeles",
      checkInDate: "2026-11-03",
      checkOutDate: "2026-11-10",
      travelers: 2,
    });

    expect(offers).toEqual([
      {
        id: "direct-token",
        name: "Downtown LA Hotel",
        chainCode: null,
        starRating: 4,
        address: "123 Main St, Los Angeles, CA",
        cityCode: "Los Angeles",
        checkInDate: "2026-11-03",
        checkOutDate: "2026-11-10",
        pricePerNightUSD: 180,
        totalPriceUSD: 1260,
        sourceBookingUrl: "https://www.downtownlahotel.com/book",
        sourceIsDirect: true,
      },
      {
        id: "ota-token",
        name: "Beachside Inn",
        chainCode: null,
        starRating: 3,
        address: "456 Ocean Ave, Los Angeles, CA",
        cityCode: "Los Angeles",
        checkInDate: "2026-11-03",
        checkOutDate: "2026-11-10",
        pricePerNightUSD: 150,
        totalPriceUSD: 1050,
        sourceBookingUrl: "https://www.booking.com/hotel/us/beachside.html",
        sourceIsDirect: false,
      },
    ]);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("skips malformed or non-positive priced properties and respects maxResults after normalization", async () => {
    vi.spyOn(client, "serpApiGet").mockResolvedValue({
      properties: [
        null,
        {},
        {
          property_token: "no-price",
          name: "No Price Hotel",
          rate_per_night: { extracted_lowest: 0 },
          total_rate: { extracted_lowest: 100 },
        },
        {
          property_token: "nan-price",
          name: "Invalid Price Hotel",
          rate_per_night: { extracted_lowest: "not-a-number" },
          total_rate: { extracted_lowest: 100 },
        },
        {
          property_token: "valid-1",
          name: "Valid One",
          rate_per_night: { extracted_lowest: 101 },
          total_rate: { extracted_lowest: 606 },
        },
        {
          property_token: "valid-2",
          name: "Valid Two",
          hotel_class: "5-star hotel",
          rate_per_night: { extracted_lowest: 202 },
          total_rate: { extracted_lowest: 1212 },
        },
      ],
    });

    const offers = await searchHotels({
      cityCode: "NYC",
      checkInDate: "2026-12-01",
      checkOutDate: "2026-12-07",
      travelers: 1,
      maxResults: 1,
    });

    expect(offers).toHaveLength(1);
    expect(offers[0]).toMatchObject({
      id: "valid-1",
      name: "Valid One",
      starRating: null,
      address: "",
      pricePerNightUSD: 101,
      totalPriceUSD: 606,
    });
  });

  it("classifies expanded OTA domains as non-direct while preserving provider links", async () => {
    vi.spyOn(client, "serpApiGet").mockResolvedValue({
      properties: [
        {
          property_token: "kayak-token",
          name: "Kayak Hotel",
          link: "https://www.kayak.com/hotels/example",
          rate_per_night: { extracted_lowest: 100 },
          total_rate: { extracted_lowest: 700 },
        },
        {
          property_token: "provider-token",
          name: "Provider Hotel",
          link: "https://www.examplehotel.com/book",
          rate_per_night: { extracted_lowest: 110 },
          total_rate: { extracted_lowest: 770 },
        },
      ],
    });

    const offers = await searchHotels({
      cityCode: "NYC",
      checkInDate: "2026-12-01",
      checkOutDate: "2026-12-08",
      travelers: 1,
    });

    expect(offers).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "kayak-token", sourceIsDirect: false }),
      expect.objectContaining({ id: "provider-token", sourceIsDirect: true }),
    ]));
  });

  it.each([-1, 0, Number.NaN, Number.POSITIVE_INFINITY])(
    "uses the default result limit for invalid maxResults (%s)",
    async (maxResults) => {
      vi.spyOn(client, "serpApiGet").mockResolvedValue({
        properties: Array.from({ length: 10 }, (_, index) => ({
          property_token: `token-${index}`,
          name: `Hotel ${index}`,
          rate_per_night: { extracted_lowest: 100 },
          total_rate: { extracted_lowest: 100 },
        })),
      });

      const offers = await searchHotels({
        cityCode: "NYC",
        checkInDate: "2026-12-01",
        checkOutDate: "2026-12-02",
        travelers: 1,
        maxResults,
      });

      expect(offers).toHaveLength(10);
    },
  );

  it("derives a multi-night total from nightly rate when total rate is missing", async () => {
    vi.spyOn(client, "serpApiGet").mockResolvedValue({
      properties: [
        {
          property_token: "nightly-only",
          name: "Nightly Only Hotel",
          rate_per_night: { extracted_lowest: 125 },
        },
        {
          property_token: "total-only",
          name: "Total Only Hotel",
          total_rate: { extracted_lowest: 1000 },
        },
      ],
    });

    const offers = await searchHotels({
      cityCode: "NYC",
      checkInDate: "2026-12-01",
      checkOutDate: "2026-12-05",
      travelers: 1,
    });

    expect(offers).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "nightly-only",
        pricePerNightUSD: 125,
        totalPriceUSD: 500,
      }),
      expect.objectContaining({
        id: "total-only",
        pricePerNightUSD: 250,
        totalPriceUSD: 1000,
      }),
    ]));
  });

  it("derives nightly rate when the extracted nightly rate is null", async () => {
    vi.spyOn(client, "serpApiGet").mockResolvedValue({
      properties: [
        {
          property_token: "null-nightly",
          name: "Null Nightly Hotel",
          rate_per_night: { extracted_lowest: null },
          total_rate: { extracted_lowest: 1000 },
        },
      ],
    });

    const offers = await searchHotels({
      cityCode: "NYC",
      checkInDate: "2026-12-01",
      checkOutDate: "2026-12-05",
      travelers: 1,
    });

    expect(offers).toEqual([
      expect.objectContaining({
        id: "null-nightly",
        pricePerNightUSD: 250,
        totalPriceUSD: 1000,
      }),
    ]);
  });

  it("derives total rate when the extracted total rate is null", async () => {
    vi.spyOn(client, "serpApiGet").mockResolvedValue({
      properties: [
        {
          property_token: "null-total",
          name: "Null Total Hotel",
          rate_per_night: { extracted_lowest: 125 },
          total_rate: { extracted_lowest: null },
        },
      ],
    });

    const offers = await searchHotels({
      cityCode: "NYC",
      checkInDate: "2026-12-01",
      checkOutDate: "2026-12-05",
      travelers: 1,
    });

    expect(offers).toEqual([
      expect.objectContaining({
        id: "null-total",
        pricePerNightUSD: 125,
        totalPriceUSD: 500,
      }),
    ]);
  });

  it("skips offers when deriving a price produces a non-finite value", async () => {
    vi.spyOn(client, "serpApiGet").mockResolvedValue({
      properties: [
        {
          property_token: "overflowing-total",
          name: "Overflowing Total Hotel",
          rate_per_night: { extracted_lowest: Number.MAX_VALUE },
        },
        {
          property_token: "valid-offer",
          name: "Valid Hotel",
          rate_per_night: { extracted_lowest: 125 },
        },
      ],
    });

    const offers = await searchHotels({
      cityCode: "NYC",
      checkInDate: "2026-12-01",
      checkOutDate: "2026-12-03",
      travelers: 1,
    });

    expect(offers).toEqual([
      expect.objectContaining({
        id: "valid-offer",
        pricePerNightUSD: 125,
        totalPriceUSD: 250,
      }),
    ]);
  });

  it("returns no offers when the top-level properties field is absent or malformed", async () => {
    const spy = vi.spyOn(client, "serpApiGet");

    spy.mockResolvedValueOnce({});
    await expect(searchHotels({
      cityCode: "SEA",
      checkInDate: "2026-12-01",
      checkOutDate: "2026-12-07",
      travelers: 1,
    })).resolves.toEqual([]);

    spy.mockResolvedValueOnce({ properties: "not-an-array" });
    await expect(searchHotels({
      cityCode: "SEA",
      checkInDate: "2026-12-01",
      checkOutDate: "2026-12-07",
      travelers: 1,
    })).resolves.toEqual([]);
  });
});
