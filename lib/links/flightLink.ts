import { CARRIER_LINK_TEMPLATES, buildGoogleFlightsUrl } from "@/lib/links/carrierMap";
import type { BookingLink, RawFlightOffer } from "@/types/travel";

export function buildFlightLink(offer: RawFlightOffer): BookingLink {
  const template = CARRIER_LINK_TEMPLATES[offer.carrierCode];
  const params = {
    origin: offer.origin,
    destination: offer.destination,
    departureDate: offer.departureDateTime.slice(0, 10),
    returnDate: offer.returnDepartureDateTime.slice(0, 10),
  };

  if (template) {
    return { url: template.buildUrl(params), isDirect: true, note: "" };
  }

  return {
    url: buildGoogleFlightsUrl(params),
    isDirect: false,
    note: `Direct link unavailable for ${offer.airline} — showing live Google Flights results instead.`,
  };
}
