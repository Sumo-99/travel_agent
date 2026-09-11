import { HOTEL_CHAIN_LINK_TEMPLATES, buildGoogleHotelsUrl } from "@/lib/links/carrierMap";
import type { BookingLink, RawHotelOffer } from "@/types/travel";

export function buildHotelLink(offer: RawHotelOffer): BookingLink {
  if (offer.sourceBookingUrl) {
    return {
      url: offer.sourceBookingUrl,
      isDirect: Boolean(offer.sourceIsDirect),
      note: offer.sourceIsDirect ? "" : `Booking link may be through a third-party site for ${offer.name}.`,
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
