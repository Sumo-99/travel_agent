export type CabinClass = "ECONOMY" | "PREMIUM_ECONOMY" | "BUSINESS" | "FIRST";

export interface TripFormInput {
  origin: string;
  destination: string;
  departureDate: string;
  returnDate: string;
  travelers: number;
  cabinClass: CabinClass;
}

export interface BookingLink {
  url: string;
  isDirect: boolean;
  note: string;
}

export interface RawFlightOffer {
  id: string;
  airline: string;
  carrierCode: string;
  flightNumber: string;
  origin: string;
  destination: string;
  departureDateTime: string;
  returnDepartureDateTime: string;
  arrivalDateTime: string;
  returnArrivalDateTime: string;
  stops: number;
  durationMinutes: number;
  priceUSD: number;
  cabinClass: CabinClass;
}

export interface FlightOffer extends RawFlightOffer {
  bookingLink: BookingLink;
}

export interface RawHotelOffer {
  id: string;
  name: string;
  chainCode: string | null;
  starRating: number | null;
  address: string;
  cityCode: string;
  checkInDate: string;
  checkOutDate: string;
  pricePerNightUSD: number;
  totalPriceUSD: number;
}

export interface HotelOffer extends RawHotelOffer {
  bookingLink: BookingLink;
}

export type ChatRole = "user" | "assistant" | "system";

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export interface SearchFlightsToolArgs {
  origin: string;
  destination: string;
  departureDate: string;
  returnDate: string;
  travelers: number;
  cabinClass: CabinClass;
  maxResults?: number;
}

export interface SearchHotelsToolArgs {
  cityCode: string;
  checkInDate: string;
  checkOutDate: string;
  travelers: number;
  maxResults?: number;
}

export interface LastFlightSearchParams {
  origin: string;
  destination: string;
  departureDate: string;
  returnDate: string;
  travelers: number;
  cabinClass: CabinClass;
}

export interface LastHotelSearchParams {
  cityCode: string;
  checkInDate: string;
  checkOutDate: string;
  travelers: number;
}

export interface SessionState {
  sessionId: string;
  messages: ChatMessage[];
  lastFlightResults: FlightOffer[];
  lastHotelResults: HotelOffer[];
  lastFlightSearchParams: LastFlightSearchParams | null;
  lastHotelSearchParams: LastHotelSearchParams | null;
}
