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

function normalizeProperty(property: SerpHotelProperty, args: SearchHotelsToolArgs): RawHotelOffer | null {
  if (!isUsableString(property.property_token) || !isUsableString(property.name)) return null;

  const pricePerNightUSD = positiveFiniteNumber(property.rate_per_night?.extracted_lowest);
  const totalPriceUSD = positiveFiniteNumber(property.total_rate?.extracted_lowest);
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

  return getProperties(response)
    .map((property) => normalizeProperty(property, args))
    .filter((offer): offer is RawHotelOffer => offer !== null)
    .slice(0, args.maxResults ?? 10);
}
