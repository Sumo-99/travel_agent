import { amadeusGet } from "@/lib/amadeus/client";
import type { RawHotelOffer, SearchHotelsToolArgs } from "@/types/travel";

// Note: the real Amadeus Hotel Search v3 API ("v3/shopping/hotel-offers") streamlined its
// hotel object and no longer includes `address` or a star `rating` on it (see the Amadeus
// Hotel Search Migration Guide: "removed specific objects such as hotelDistance, address,
// contact, amenities, and media"). These fields are therefore typed and read defensively
// here — present in the mock fixture this module's tests pin down, but optional/absent on
// live responses.
interface AmadeusHotelOfferRaw {
  hotel: {
    hotelId: string;
    name: string;
    chainCode: string | null;
    rating?: string;
    cityCode?: string;
    address?: { lines?: string[]; cityName?: string };
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

function formatAddress(hotel: AmadeusHotelOfferRaw["hotel"]): string {
  const lines = hotel.address?.lines ?? [];
  const cityName = hotel.address?.cityName;
  const parts = [...lines, cityName].filter((part): part is string => Boolean(part));
  return parts.length > 0 ? parts.join(", ") : (hotel.cityCode ?? "");
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
      address: formatAddress(entry.hotel),
      cityCode: args.cityCode,
      checkInDate: args.checkInDate,
      checkOutDate: args.checkOutDate,
      pricePerNightUSD: totalPriceUSD / nights,
      totalPriceUSD,
    };
  });
}
