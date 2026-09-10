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

  it("drops hotel entries with an empty offers array instead of defaulting to a phantom $0 price", async () => {
    vi.spyOn(client, "amadeusGet").mockResolvedValue({
      data: [
        {
          hotel: {
            hotelId: "H-NO-OFFERS",
            name: "Sold Out Inn",
            chainCode: null,
            address: { cityName: "Los Angeles" },
          },
          offers: [],
        },
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
    expect(offers.map((o) => o.id)).not.toContain("H-NO-OFFERS");
    expect(offers[0].totalPriceUSD).toBe(620);
  });
});
