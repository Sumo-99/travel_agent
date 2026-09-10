interface FlightLinkTemplate {
  name: string;
  buildUrl: (p: { origin: string; destination: string; departureDate: string; returnDate: string }) => string;
}

interface HotelLinkTemplate {
  name: string;
  buildUrl: (p: { cityName: string; checkInDate: string; checkOutDate: string }) => string;
}

// Best-effort deep links into each carrier's own booking-search page.
// These query-string patterns are unofficial and can break if a carrier
// changes their site; that's an accepted tradeoff for v1 (see spec).
export const CARRIER_LINK_TEMPLATES: Record<string, FlightLinkTemplate> = {
  DL: {
    name: "Delta Air Lines",
    buildUrl: ({ origin, destination, departureDate, returnDate }) =>
      `https://www.delta.com/flight-search/book-a-flight?tripType=ROUND_TRIP&originCity=${origin}&destinationCity=${destination}&departureDate=${departureDate}&returnDate=${returnDate}`,
  },
  UA: {
    name: "United Airlines",
    buildUrl: ({ origin, destination, departureDate, returnDate }) =>
      `https://www.united.com/en/us/fsr/choose-flights?f=${origin}&t=${destination}&d=${departureDate}&r=${returnDate}&tt=1`,
  },
  AA: {
    name: "American Airlines",
    buildUrl: ({ origin, destination, departureDate, returnDate }) =>
      `https://www.aa.com/booking/find-flights?tripType=roundTrip&originAirport=${origin}&destinationAirport=${destination}&departureDate=${departureDate}&returnDate=${returnDate}`,
  },
  WN: {
    name: "Southwest Airlines",
    buildUrl: ({ origin, destination, departureDate, returnDate }) =>
      `https://www.southwest.com/air/booking/select.html?originationAirportCode=${origin}&destinationAirportCode=${destination}&departureDate=${departureDate}&returnDate=${returnDate}&tripType=roundtrip`,
  },
  B6: {
    name: "JetBlue",
    buildUrl: ({ origin, destination, departureDate, returnDate }) =>
      `https://www.jetblue.com/booking/flights?from=${origin}&to=${destination}&depart=${departureDate}&return=${returnDate}&isMultiCity=false`,
  },
  AS: {
    name: "Alaska Airlines",
    buildUrl: ({ origin, destination, departureDate, returnDate }) =>
      `https://www.alaskaair.com/booking/reservation-flights?A-Origin=${origin}&A-Destination=${destination}&A-DepartDate=${departureDate}&A-ReturnDate=${returnDate}&A-TripType=roundtrip`,
  },
};

export const HOTEL_CHAIN_LINK_TEMPLATES: Record<string, HotelLinkTemplate> = {
  EM: {
    name: "Marriott",
    buildUrl: ({ cityName, checkInDate, checkOutDate }) =>
      `https://www.marriott.com/search/default.mi?destinationAddress.destination=${encodeURIComponent(cityName)}&fromDate=${checkInDate}&toDate=${checkOutDate}`,
  },
  HL: {
    name: "Hilton",
    buildUrl: ({ cityName, checkInDate, checkOutDate }) =>
      `https://www.hilton.com/en/search/?arrivalDate=${checkInDate}&departureDate=${checkOutDate}&query=${encodeURIComponent(cityName)}`,
  },
  HY: {
    name: "Hyatt",
    buildUrl: ({ cityName, checkInDate, checkOutDate }) =>
      `https://www.hyatt.com/search?checkinDate=${checkInDate}&checkoutDate=${checkOutDate}&location=${encodeURIComponent(cityName)}`,
  },
};

export function buildGoogleFlightsUrl(p: {
  origin: string;
  destination: string;
  departureDate: string;
  returnDate: string;
}): string {
  const query = `Flights from ${p.origin} to ${p.destination} on ${p.departureDate} through ${p.returnDate}`;
  return `https://www.google.com/travel/flights?q=${encodeURIComponent(query)}`;
}

export function buildGoogleHotelsUrl(p: { cityName: string; checkInDate: string; checkOutDate: string }): string {
  const query = `Hotels in ${p.cityName} from ${p.checkInDate} to ${p.checkOutDate}`;
  return `https://www.google.com/travel/hotels?q=${encodeURIComponent(query)}`;
}
