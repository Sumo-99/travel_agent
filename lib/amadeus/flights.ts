import { amadeusGet } from "@/lib/amadeus/client";
import type { RawFlightOffer, SearchFlightsToolArgs } from "@/types/travel";

interface AmadeusSegment {
  departure: { iataCode: string; at: string };
  arrival: { iataCode: string; at: string };
  carrierCode: string;
  number: string;
}

interface AmadeusItinerary {
  segments: AmadeusSegment[];
  duration: string;
}

interface AmadeusFlightOfferRaw {
  id: string;
  price: { total: string };
  itineraries: AmadeusItinerary[];
}

interface AmadeusFlightOffersResponse {
  data: AmadeusFlightOfferRaw[];
  dictionaries?: { carriers?: Record<string, string> };
}

function parseIsoDurationToMinutes(iso: string): number {
  const match = /PT(?:(\d+)H)?(?:(\d+)M)?/.exec(iso);
  const hours = Number(match?.[1] ?? 0);
  const minutes = Number(match?.[2] ?? 0);
  return hours * 60 + minutes;
}

export async function searchFlights(args: SearchFlightsToolArgs): Promise<RawFlightOffer[]> {
  const response = await amadeusGet<AmadeusFlightOffersResponse>("/v2/shopping/flight-offers", {
    originLocationCode: args.origin,
    destinationLocationCode: args.destination,
    departureDate: args.departureDate,
    returnDate: args.returnDate,
    adults: String(args.travelers),
    travelClass: args.cabinClass,
    currencyCode: "USD",
    max: String(args.maxResults ?? 10),
  });

  const carrierNames = response.dictionaries?.carriers ?? {};

  return response.data.map((offer) => {
    const outbound = offer.itineraries[0];
    const inbound = offer.itineraries[1];
    const firstSegment = outbound.segments[0];
    const lastOutboundSegment = outbound.segments[outbound.segments.length - 1];
    const firstInboundSegment = inbound.segments[0];
    const lastInboundSegment = inbound.segments[inbound.segments.length - 1];

    return {
      id: offer.id,
      airline: carrierNames[firstSegment.carrierCode] ?? firstSegment.carrierCode,
      carrierCode: firstSegment.carrierCode,
      flightNumber: firstSegment.number,
      origin: firstSegment.departure.iataCode,
      destination: lastOutboundSegment.arrival.iataCode,
      departureDateTime: firstSegment.departure.at,
      arrivalDateTime: lastOutboundSegment.arrival.at,
      returnDepartureDateTime: firstInboundSegment.departure.at,
      returnArrivalDateTime: lastInboundSegment.arrival.at,
      stops: outbound.segments.length - 1,
      durationMinutes:
        parseIsoDurationToMinutes(outbound.duration) + parseIsoDurationToMinutes(inbound.duration),
      priceUSD: Number(offer.price.total),
      cabinClass: args.cabinClass,
    };
  });
}
