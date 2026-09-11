import { serpApiGet } from "@/lib/serpapi/client";
import type { RawFlightOffer, SearchFlightsToolArgs } from "@/types/travel";

interface SerpFlightSegment {
  departure_airport?: { id?: string; time?: string };
  arrival_airport?: { id?: string; time?: string };
  airline?: string;
  flight_number?: string;
  duration?: number;
}

interface SerpFlightItinerary {
  flights?: Array<SerpFlightSegment | null>;
  total_duration?: number;
  price?: number;
  departure_token?: string;
  booking_token?: string;
}

interface SerpFlightsSearchResponse {
  best_flights?: Array<SerpFlightItinerary | null>;
  other_flights?: Array<SerpFlightItinerary | null>;
}

interface SerpBookingOption {
  together?: {
    book_with?: string;
    airline?: boolean;
    booking_request?: { url?: string; post_data?: unknown };
  };
}

interface SerpBookingOptionsResponse {
  booking_options?: Array<SerpBookingOption | null>;
}

type ValidSerpFlightSegment = SerpFlightSegment & {
  departure_airport: { id: string; time: string };
  arrival_airport: { id: string; time: string };
  airline: string;
  flight_number: string;
};

const CABIN_CLASS_TO_TRAVEL_CLASS: Record<SearchFlightsToolArgs["cabinClass"], string> = {
  ECONOMY: "1",
  PREMIUM_ECONOMY: "2",
  BUSINESS: "3",
  FIRST: "4",
};

function splitCarrierCodeAndNumber(flightNumber: string): { carrierCode: string; number: string } {
  const [carrierCode, number] = flightNumber.trim().split(/\s+/);
  return { carrierCode: carrierCode ?? "", number: number ?? flightNumber.trim() };
}

function isUsableString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function trimUsableString(value: unknown): string | undefined {
  return isUsableString(value) ? value.trim() : undefined;
}

function usableHttpUrl(value: unknown): string | undefined {
  if (!isUsableString(value)) return undefined;

  try {
    const url = new URL(value.trim());
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getArrayField<T>(response: unknown, field: string): T[] {
  if (!isRecord(response) || !Array.isArray(response[field])) return [];
  return response[field] as T[];
}

function isValidFlightSegment(segment: SerpFlightSegment | null): segment is ValidSerpFlightSegment {
  return Boolean(
    segment &&
      isUsableString(segment.departure_airport?.id) &&
      isUsableString(segment.departure_airport?.time) &&
      isUsableString(segment.arrival_airport?.id) &&
      isUsableString(segment.arrival_airport?.time) &&
      isUsableString(segment.airline) &&
      isUsableString(segment.flight_number),
  );
}

function isValidItinerary(itinerary: SerpFlightItinerary | null): itinerary is SerpFlightItinerary & {
  flights: ValidSerpFlightSegment[];
  total_duration: number;
} {
  return Boolean(
    itinerary &&
      Array.isArray(itinerary.flights) &&
      itinerary.flights.length > 0 &&
      typeof itinerary.total_duration === "number" &&
      Number.isFinite(itinerary.total_duration) &&
      itinerary.total_duration >= 0 &&
      itinerary.flights.every(isValidFlightSegment),
  );
}

async function fetchBookingLink(bookingToken: string): Promise<{ url?: string; isDirect?: boolean }> {
  const response = await serpApiGet<SerpBookingOptionsResponse>({
    engine: "google_flights",
    booking_token: bookingToken,
    currency: "USD",
    hl: "en",
    gl: "us",
  });

  const option = getArrayField<SerpBookingOption | null>(response, "booking_options")
    .map((bookingOption) => bookingOption?.together)
    .find((together) => {
      const bookingRequest = together?.booking_request;
      return Boolean(
        isRecord(bookingRequest) &&
          !("post_data" in bookingRequest) &&
          usableHttpUrl(bookingRequest.url),
      );
    });
  const url = usableHttpUrl(option?.booking_request?.url);
  if (!url) return {};

  return {
    url,
    isDirect: Boolean(option?.airline),
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

  const maxResults = typeof args.maxResults === "number" && Number.isFinite(args.maxResults) && args.maxResults > 0
    ? Math.max(1, Math.floor(args.maxResults))
    : 10;
  const outboundOptions = [
    ...getArrayField<SerpFlightItinerary | null>(response, "best_flights"),
    ...getArrayField<SerpFlightItinerary | null>(response, "other_flights"),
  ]
    .filter(isValidItinerary)
    .filter((outbound) => isUsableString(outbound.departure_token))
    .slice(0, maxResults);
  const offers: RawFlightOffer[] = [];
  const emittedBookingTokens = new Set<string>();

  for (const outbound of outboundOptions) {
    const departureToken = trimUsableString(outbound.departure_token);
    if (!departureToken) continue;

    const returnResponse = await serpApiGet<SerpFlightsSearchResponse>({
      engine: "google_flights",
      departure_token: departureToken,
      currency: "USD",
      hl: "en",
      gl: "us",
    });
    const returnOptions = [
      ...getArrayField<SerpFlightItinerary | null>(returnResponse, "best_flights"),
      ...getArrayField<SerpFlightItinerary | null>(returnResponse, "other_flights"),
    ];
    const outboundSegment = outbound.flights[0];
    const outboundLast = outbound.flights[outbound.flights.length - 1];
    if (!outboundSegment || !outboundLast) continue;
    const { carrierCode, number } = splitCarrierCodeAndNumber(outboundSegment.flight_number);

    for (const returning of returnOptions) {
      if (offers.length >= maxResults) break;
      if (!isValidItinerary(returning)) continue;
      const bookingToken = trimUsableString(returning.booking_token);
      if (!bookingToken) continue;

      const inboundFirst = returning.flights[0];
      const inboundLast = returning.flights[returning.flights.length - 1];
      if (!inboundFirst || !inboundLast) continue;
      const priceUSD = returning.price ?? outbound.price;
      if (typeof priceUSD !== "number" || !Number.isFinite(priceUSD) || priceUSD <= 0) continue;

      if (emittedBookingTokens.has(bookingToken)) continue;
      emittedBookingTokens.add(bookingToken);
      let bookingLink: { url?: string; isDirect?: boolean } = {};
      try {
        bookingLink = await fetchBookingLink(bookingToken);
      } catch {
        // Keep the normalized offer so its carrier or Google Flights fallback can be used.
      }

      offers.push({
        id: bookingToken,
        airline: outboundSegment.airline.trim(),
        carrierCode,
        flightNumber: number,
        origin: outboundSegment.departure_airport.id.trim(),
        destination: outboundLast.arrival_airport.id.trim(),
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
