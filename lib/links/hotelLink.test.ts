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
