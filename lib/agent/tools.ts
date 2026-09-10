export const searchFlightsToolSchema = {
  type: "function",
  function: {
    name: "search_flights",
    description:
      "Search round-trip domestic US flights. Always pass the full known criteria; the backend " +
      "decides internally whether to reuse cached results or query fresh. Do not withhold criteria " +
      "you already know just because a previous search used them.",
    parameters: {
      type: "object",
      properties: {
        origin: { type: "string", description: "3-letter IATA airport code, e.g. JFK" },
        destination: { type: "string", description: "3-letter IATA airport code, e.g. LAX" },
        departureDate: { type: "string", description: "YYYY-MM-DD" },
        returnDate: { type: "string", description: "YYYY-MM-DD" },
        travelers: { type: "number" },
        cabinClass: { type: "string", enum: ["ECONOMY", "PREMIUM_ECONOMY", "BUSINESS", "FIRST"] },
        maxPriceUSD: { type: "number", description: "Optional max total price filter" },
        maxStops: { type: "number", description: "Optional max number of stops filter" },
      },
      required: ["origin", "destination", "departureDate", "returnDate", "travelers", "cabinClass"],
    },
  },
} as const;

export const searchHotelsToolSchema = {
  type: "function",
  function: {
    name: "search_hotels",
    description:
      "Search hotels in a US city for given check-in/check-out dates. Always pass the full known " +
      "criteria; the backend decides internally whether to reuse cached results or query fresh.",
    parameters: {
      type: "object",
      properties: {
        cityCode: {
          type: "string",
          description:
            "3-letter IATA CITY code — NOT necessarily the same as a nearby airport code. " +
            "E.g. JFK/LGA/EWR all map to city code NYC; ORD/MDW map to CHI. When given an " +
            "airport code, convert it to the correct city code before calling this tool.",
        },
        checkInDate: { type: "string", description: "YYYY-MM-DD" },
        checkOutDate: { type: "string", description: "YYYY-MM-DD" },
        travelers: { type: "number" },
        maxPricePerNightUSD: { type: "number" },
        minStarRating: { type: "number" },
      },
      required: ["cityCode", "checkInDate", "checkOutDate", "travelers"],
    },
  },
} as const;
