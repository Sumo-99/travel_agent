import { serpApiGet } from "@/lib/serpapi/client";
import type { RawHotelOffer, SearchHotelsToolArgs } from "@/types/travel";

interface SerpHotelsResponse {
  properties?: unknown;
}

interface SerpHotelProperty {
  property_token?: unknown;
  name?: unknown;
  extracted_hotel_class?: unknown;
  hotel_class?: unknown;
  address?: unknown;
  link?: unknown;
  rate_per_night?: { extracted_lowest?: unknown };
  total_rate?: { extracted_lowest?: unknown };
}

const KNOWN_OTA_DOMAINS = new Set([
  "booking.com",
  "expedia.com",
  "hotels.com",
  "agoda.com",
  "trip.com",
  "priceline.com",
  "kayak.com",
  "travelocity.com",
  "orbitz.com",
  "tripadvisor.com",
  "hotwire.com",
  "hotelscombined.com",
  "trivago.com",
  "momondo.com",
  "skyscanner.com",
  "hostelworld.com",
  "traveloka.com",
  "ebookers.com",
  "wotif.com",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isUsableString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function positiveFiniteNumber(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return undefined;
  return value;
}

function parseStarRating(property: SerpHotelProperty): number | null {
  const extracted = positiveFiniteNumber(property.extracted_hotel_class);
  if (extracted !== undefined) return extracted;

  if (typeof property.hotel_class !== "string") return null;
  const match = property.hotel_class.match(/(\d+(?:\.\d+)?)\s*-?\s*star\s+hotel/i);
  if (!match) return null;

  const parsed = Number(match[1]);
  return Number.isFinite(parsed) ? parsed : null;
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

function isKnownOtaUrl(url: string): boolean {
  const hostname = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  return [...KNOWN_OTA_DOMAINS].some((domain) => hostname === domain || hostname.endsWith(`.${domain}`));
}

function asHotelProperty(value: unknown): SerpHotelProperty | null {
  return isRecord(value) ? value : null;
}

function getProperties(response: unknown): SerpHotelProperty[] {
  if (!isRecord(response) || !Array.isArray(response.properties)) return [];
  return response.properties.map(asHotelProperty).filter((property): property is SerpHotelProperty => property !== null);
}

function numberOfNights(args: SearchHotelsToolArgs): number {
  const checkIn = Date.parse(`${args.checkInDate}T00:00:00Z`);
  const checkOut = Date.parse(`${args.checkOutDate}T00:00:00Z`);
  if (!Number.isFinite(checkIn) || !Number.isFinite(checkOut) || checkOut <= checkIn) return 1;

  return Math.max(1, Math.round((checkOut - checkIn) / (24 * 60 * 60 * 1000)));
}

function normalizeProperty(property: SerpHotelProperty, args: SearchHotelsToolArgs): RawHotelOffer | null {
  if (!isUsableString(property.property_token) || !isUsableString(property.name)) return null;

  const rawNightlyRate = property.rate_per_night?.extracted_lowest;
  const rawTotalRate = property.total_rate?.extracted_lowest;
  const nightlyRate = positiveFiniteNumber(rawNightlyRate);
  const totalRate = positiveFiniteNumber(rawTotalRate);
  if ((rawNightlyRate !== undefined && rawNightlyRate !== null && nightlyRate === undefined) ||
    (rawTotalRate !== undefined && rawTotalRate !== null && totalRate === undefined)) {
    return null;
  }

  const nights = numberOfNights(args);
  const derivedPricePerNightUSD = nightlyRate ?? (rawTotalRate === undefined || rawTotalRate === null || totalRate === undefined ? undefined : totalRate / nights);
  const derivedTotalPriceUSD = totalRate ?? (rawNightlyRate === undefined || rawNightlyRate === null || nightlyRate === undefined ? undefined : nightlyRate * nights);
  const pricePerNightUSD = positiveFiniteNumber(derivedPricePerNightUSD);
  const totalPriceUSD = positiveFiniteNumber(derivedTotalPriceUSD);
  if (pricePerNightUSD === undefined || totalPriceUSD === undefined) return null;

  const sourceBookingUrl = usableHttpUrl(property.link);
  const offer: RawHotelOffer = {
    id: property.property_token.trim(),
    name: property.name.trim(),
    chainCode: null,
    starRating: parseStarRating(property),
    address: isUsableString(property.address) ? property.address.trim() : "",
    cityCode: args.cityCode,
    checkInDate: args.checkInDate,
    checkOutDate: args.checkOutDate,
    pricePerNightUSD,
    totalPriceUSD,
  };

  if (sourceBookingUrl) {
    offer.sourceBookingUrl = sourceBookingUrl;
    offer.sourceIsDirect = !isKnownOtaUrl(sourceBookingUrl);
  }

  return offer;
}

export async function searchHotels(args: SearchHotelsToolArgs): Promise<RawHotelOffer[]> {
  // NOTE: cityCode is treated as a free-text location hint, not a strict
  // IATA lookup — Google Hotels accepts natural-language q values. This is
  // an accepted accuracy tradeoff for this migration; a proper IATA-to-city
  // name map is a future improvement.
  const response = await serpApiGet<SerpHotelsResponse>({
    engine: "google_hotels",
    q: `${args.cityCode} hotels`,
    check_in_date: args.checkInDate,
    check_out_date: args.checkOutDate,
    adults: String(args.travelers),
    currency: "USD",
    hl: "en",
    gl: "us",
  });

  const maxResults = typeof args.maxResults === "number" && Number.isFinite(args.maxResults) && args.maxResults > 0
    ? Math.max(1, Math.floor(args.maxResults))
    : 10;

  return getProperties(response)
    .map((property) => normalizeProperty(property, args))
    .filter((offer): offer is RawHotelOffer => offer !== null)
    .slice(0, maxResults);
}
