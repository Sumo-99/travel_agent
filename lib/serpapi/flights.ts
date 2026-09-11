import { serpApiGet } from "@/lib/serpapi/client";
import type { RawFlightOffer, SearchFlightsToolArgs } from "@/types/travel";

interface SerpFlightSegment {
  departure_airport: { id: string; time: string };
  arrival_airport: { id: string; time: string };
  airline: string;
  flight_number: string;
  duration?: number;
}

interface SerpFlightItinerary {
  flights: SerpFlightSegment[];
  total_duration: number;
  price?: number;
  departure_token?: string;
  booking_token?: string;
}

interface SerpFlightsSearchResponse {
  best_flights?: SerpFlightItinerary[];
  other_flights?: SerpFlightItinerary[];
}

interface SerpBookingOption {
  together?: {
    book_with: string;
    airline?: boolean;
    booking_request: { url: string };
  };
}

interface SerpBookingOptionsResponse {
  booking_options?: SerpBookingOption[];
}

const CABIN_CLASS_TO_TRAVEL_CLASS: Record<SearchFlightsToolArgs["cabinClass"], string> = {
  ECONOMY: "1",
  PREMIUM_ECONOMY: "2",
  BUSINESS: "3",
  FIRST: "4",
};

function splitCarrierCodeAndNumber(flightNumber: string): { carrierCode: string; number: string } {
  const [carrierCode, number] = flightNumber.split(" ");
  return { carrierCode: carrierCode ?? "", number: number ?? flightNumber };
}

async function fetchBookingLink(bookingToken: string): Promise<{ url?: string; isDirect?: boolean }> {
  const response = await serpApiGet<SerpBookingOptionsResponse>({
    engine: "google_flights",
    booking_token: bookingToken,
    currency: "USD",
    hl: "en",
    gl: "us",
  });

  const option = response.booking_options?.[0]?.together;
  if (!option?.booking_request?.url) return {};

  return {
    url: option.booking_request.url,
    isDirect: Boolean(option.airline),
  };
}

export async function searchFlights(args: SearchFlightsToolArgs): Promise<RawFlightOffer[]> {
  const response = await serpApiGet<SerpFlightsSearchResponse>({
    engine: "google_flights",
    departure_id: args.origin,
    arrival_id: args.destination,
    outbound_date: args.departureDate,
    return_date: args.returnDate,
    adults: String(args.travelers),
    travel_class: CABIN_CLASS_TO_TRAVEL_CLASS[args.cabinClass],
    type: "1",
    currency: "USD",
    hl: "en",
    gl: "us",
  });

  const maxResults = args.maxResults ?? 10;
  const outboundOptions = [...(response.best_flights ?? []), ...(response.other_flights ?? [])].slice(0, maxResults);
  const offers: RawFlightOffer[] = [];

  for (const outbound of outboundOptions) {
    if (!outbound.departure_token || outbound.flights.length === 0) continue;

    const returnResponse = await serpApiGet<SerpFlightsSearchResponse>({
      engine: "google_flights",
      departure_token: outbound.departure_token,
      currency: "USD",
      hl: "en",
      gl: "us",
    });
    const returnOptions = [...(returnResponse.best_flights ?? []), ...(returnResponse.other_flights ?? [])];
    const outboundSegment = outbound.flights[0];
    const outboundLast = outbound.flights[outbound.flights.length - 1];
    const { carrierCode, number } = splitCarrierCodeAndNumber(outboundSegment.flight_number);

    for (const returning of returnOptions) {
      if (offers.length >= maxResults) break;
      if (returning.flights.length === 0) continue;

      const inboundFirst = returning.flights[0];
      const inboundLast = returning.flights[returning.flights.length - 1];
      const priceUSD = returning.price ?? outbound.price;
      if (priceUSD === undefined || priceUSD <= 0) continue;

      const bookingToken = returning.booking_token;
      const bookingLink = bookingToken ? await fetchBookingLink(bookingToken) : {};

      offers.push({
        id: bookingToken ?? `${outbound.departure_token}:${inboundFirst.departure_airport.time}`,
        airline: outboundSegment.airline,
        carrierCode,
        flightNumber: number,
        origin: outboundSegment.departure_airport.id,
        destination: outboundLast.arrival_airport.id,
        departureDateTime: outboundSegment.departure_airport.time,
        arrivalDateTime: outboundLast.arrival_airport.time,
        returnDepartureDateTime: inboundFirst.departure_airport.time,
        returnArrivalDateTime: inboundLast.arrival_airport.time,
        stops: Math.max(0, outbound.flights.length - 1),
        durationMinutes: outbound.total_duration + returning.total_duration,
        priceUSD,
        cabinClass: args.cabinClass,
        sourceBookingUrl: bookingLink.url,
        sourceIsDirect: bookingLink.isDirect,
      });
    }
  }

  return offers;
}
