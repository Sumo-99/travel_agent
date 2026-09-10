import { describe, it, expect, vi, beforeEach } from "vitest";
import { createOrchestrator, type AgentDependencies } from "@/lib/agent/orchestrator";
import type { RawFlightOffer, RawHotelOffer, SessionState } from "@/types/travel";

// `vi.mock` is hoisted above the imports, so the spy has to be created with
// `vi.hoisted` to exist by the time the factory runs.
const { createCompletion } = vi.hoisted(() => ({ createCompletion: vi.fn() }));

vi.mock("openai", () => ({
  default: class MockOpenAI {
    chat = { completions: { create: createCompletion } };
  },
}));

function freshSession(): SessionState {
  return {
    sessionId: "s1",
    messages: [],
    lastFlightResults: [],
    lastHotelResults: [],
    displayedFlights: [],
    displayedHotels: [],
    lastFlightSearchParams: null,
    lastHotelSearchParams: null,
  };
}

const sampleRaw: RawFlightOffer = {
  id: "1",
  airline: "Delta Air Lines",
  carrierCode: "DL",
  flightNumber: "204",
  origin: "JFK",
  destination: "LAX",
  departureDateTime: "2026-11-03T08:00:00",
  arrivalDateTime: "2026-11-03T11:20:00",
  returnDepartureDateTime: "2026-11-10T13:00:00",
  returnArrivalDateTime: "2026-11-10T21:15:00",
  stops: 0,
  durationMinutes: 380,
  priceUSD: 412.5,
  cabinClass: "ECONOMY",
};

const sampleHotelRaw: RawHotelOffer = {
  id: "h1",
  name: "Grand Plaza",
  chainCode: "HY",
  starRating: 4,
  address: "123 Main St",
  cityCode: "LAX",
  checkInDate: "2026-11-03",
  checkOutDate: "2026-11-10",
  pricePerNightUSD: 180,
  totalPriceUSD: 1260,
};

const jfkToLax = {
  origin: "JFK",
  destination: "LAX",
  departureDate: "2026-11-03",
  returnDate: "2026-11-10",
  travelers: 1,
  cabinClass: "ECONOMY" as const,
};

const laxStay = {
  cityCode: "LAX",
  checkInDate: "2026-11-03",
  checkOutDate: "2026-11-10",
  travelers: 1,
};

describe("orchestrator refinement logic", () => {
  let deps: AgentDependencies;

  beforeEach(() => {
    deps = {
      searchFlights: vi.fn(async () => [sampleRaw]),
      searchHotels: vi.fn(async () => []),
      buildFlightLink: vi.fn(() => ({ url: "https://example.com", isDirect: true, note: "" })),
      buildHotelLink: vi.fn(() => ({ url: "https://example.com", isDirect: true, note: "" })),
    };
  });

  it("reuses cached results and does not call searchFlights again when only a tighter filter is requested", async () => {
    const session = freshSession();
    session.lastFlightSearchParams = { ...jfkToLax };
    session.lastFlightResults = [{ ...sampleRaw, bookingLink: { url: "x", isDirect: true, note: "" } }];

    const orchestrator = createOrchestrator(deps);
    const result = await orchestrator.__internal.runFlightSearch(
      { ...jfkToLax, maxPriceUSD: 500 },
      session
    );

    expect(deps.searchFlights).not.toHaveBeenCalled();
    expect(result).toHaveLength(1);
  });

  it("writes the filtered set to session.displayedFlights (not the full cache) on a cache-hit refinement, so the table reflects what the model was told", async () => {
    const session = freshSession();
    session.lastFlightSearchParams = { ...jfkToLax };
    session.lastFlightResults = [
      { ...sampleRaw, id: "cheap", priceUSD: 200, bookingLink: { url: "x", isDirect: true, note: "" } },
      { ...sampleRaw, id: "pricey", priceUSD: 900, bookingLink: { url: "x", isDirect: true, note: "" } },
    ];

    const orchestrator = createOrchestrator(deps);
    const result = await orchestrator.__internal.runFlightSearch(
      { ...jfkToLax, maxPriceUSD: 500 },
      session
    );

    expect(deps.searchFlights).not.toHaveBeenCalled();
    // The returned/displayed slice is filtered...
    expect(result.map((r) => r.id)).toEqual(["cheap"]);
    // ...and the session's "currently displayed" projection matches it...
    expect(session.displayedFlights.map((r) => r.id)).toEqual(["cheap"]);
    // ...while the full refinement cache is left untouched (both offers still available
    // for a future "show me all of them" without a new Amadeus call).
    expect(session.lastFlightResults).toHaveLength(2);
    expect(session.displayedFlights).not.toEqual(session.lastFlightResults);
  });

  it("calls searchFlights, re-ranks, and does NOT merge in the stale route's offers when the route changes", async () => {
    // The fresh offer must carry a DIFFERENT id from the cached one, otherwise the
    // merge collapses to a single element and both the dedupe and the ordering
    // assertions pass vacuously.
    const sfoOfferA: RawFlightOffer = {
      ...sampleRaw,
      id: "sfo-a",
      destination: "SFO",
      priceUSD: 610,
    };
    const sfoOfferB: RawFlightOffer = {
      ...sampleRaw,
      id: "sfo-b",
      destination: "SFO",
      priceUSD: 305,
    };
    deps.searchFlights = vi.fn(async () => [sfoOfferA, sfoOfferB]);

    const session = freshSession();
    session.lastFlightSearchParams = { ...jfkToLax };
    session.lastFlightResults = [
      { ...sampleRaw, id: "stale-lax", bookingLink: { url: "x", isDirect: true, note: "" } },
    ];

    const orchestrator = createOrchestrator(deps);
    const result = await orchestrator.__internal.runFlightSearch(
      { ...jfkToLax, destination: "SFO" },
      session
    );

    expect(deps.searchFlights).toHaveBeenCalledTimes(1);
    // Re-ranked ascending by price.
    expect(result.every((r, i, arr) => i === 0 || arr[i - 1].priceUSD <= r.priceUSD)).toBe(true);
    expect(result.map((r) => r.id)).toEqual(["sfo-b", "sfo-a"]);
    // The previous route's offer must not leak into the new route's results...
    expect(result.map((r) => r.id)).not.toContain("stale-lax");
    // ...nor into the cache that later refinements of this route are served from.
    expect(session.lastFlightResults.map((r) => r.id)).not.toContain("stale-lax");
    expect(session.lastFlightSearchParams?.destination).toBe("SFO");
  });

  it("does not serve the old route from cache on a later refinement of the new route", async () => {
    deps.searchFlights = vi.fn(async () => [
      { ...sampleRaw, id: "sfo-a", destination: "SFO", priceUSD: 305 },
    ]);

    const session = freshSession();
    session.lastFlightSearchParams = { ...jfkToLax };
    session.lastFlightResults = [
      { ...sampleRaw, id: "stale-lax", priceUSD: 120, bookingLink: { url: "x", isDirect: true, note: "" } },
    ];

    const orchestrator = createOrchestrator(deps);
    await orchestrator.__internal.runFlightSearch({ ...jfkToLax, destination: "SFO" }, session);
    const refined = await orchestrator.__internal.runFlightSearch(
      { ...jfkToLax, destination: "SFO", maxPriceUSD: 400 },
      session
    );

    // The cheap stale LAX offer would otherwise sort to the top of every SFO refinement.
    expect(refined.map((r) => r.id)).toEqual(["sfo-a"]);
  });

  it("falls through to a fresh search when the cached results do not satisfy the filter", async () => {
    const session = freshSession();
    session.lastFlightSearchParams = { ...jfkToLax };
    session.lastFlightResults = [
      { ...sampleRaw, id: "expensive", priceUSD: 900, bookingLink: { url: "x", isDirect: true, note: "" } },
    ];

    const orchestrator = createOrchestrator(deps);
    const result = await orchestrator.__internal.runFlightSearch(
      { ...jfkToLax, maxPriceUSD: 500 },
      session
    );

    expect(deps.searchFlights).toHaveBeenCalledTimes(1);
    expect(result.map((r) => r.id)).toEqual(["1"]);
    // Same route, so the cache is topped up rather than replaced: the returned view is
    // filtered, but both offers stay available for the next refinement.
    expect(session.lastFlightResults).toHaveLength(2);
  });

  it("attaches booking links and caches hotel results and params on a fresh hotel search", async () => {
    deps.searchHotels = vi.fn(async () => [sampleHotelRaw]);
    const session = freshSession();

    const orchestrator = createOrchestrator(deps);
    const result = await orchestrator.__internal.runHotelSearch({ ...laxStay }, session);

    expect(deps.searchHotels).toHaveBeenCalledTimes(1);
    expect(result).toHaveLength(1);
    expect(result[0].bookingLink.url).toBe("https://example.com");
    expect(session.lastHotelResults).toHaveLength(1);
    expect(session.lastHotelSearchParams).toEqual(laxStay);
  });

  it("reuses cached hotels when the stay matches and a tighter filter is requested", async () => {
    deps.searchHotels = vi.fn(async () => [sampleHotelRaw]);
    const session = freshSession();
    session.lastHotelSearchParams = { ...laxStay };
    session.lastHotelResults = [
      { ...sampleHotelRaw, bookingLink: { url: "x", isDirect: true, note: "" } },
      {
        ...sampleHotelRaw,
        id: "h2",
        name: "Budget Inn",
        starRating: 2,
        pricePerNightUSD: 400,
        bookingLink: { url: "y", isDirect: false, note: "" },
      },
    ];

    const orchestrator = createOrchestrator(deps);
    const result = await orchestrator.__internal.runHotelSearch(
      { ...laxStay, maxPricePerNightUSD: 200, minStarRating: 3 },
      session
    );

    expect(deps.searchHotels).not.toHaveBeenCalled();
    expect(result.map((h) => h.id)).toEqual(["h1"]);
    // Same fix as flights: the displayed/table projection reflects the filtered
    // result on the cache-hit path, distinct from the full lastHotelResults cache.
    expect(session.displayedHotels.map((h) => h.id)).toEqual(["h1"]);
    expect(session.lastHotelResults).toHaveLength(2);
  });

  it("searches fresh when the city changes even though the dates are identical", async () => {
    const sfoHotel: RawHotelOffer = {
      ...sampleHotelRaw,
      id: "sfo-h1",
      name: "Bay View",
      cityCode: "SFO",
      pricePerNightUSD: 250,
    };
    deps.searchHotels = vi.fn(async () => [sfoHotel]);

    const session = freshSession();
    session.lastHotelSearchParams = { ...laxStay };
    session.lastHotelResults = [{ ...sampleHotelRaw, bookingLink: { url: "x", isDirect: true, note: "" } }];

    const orchestrator = createOrchestrator(deps);
    const result = await orchestrator.__internal.runHotelSearch({ ...laxStay, cityCode: "SFO" }, session);

    expect(deps.searchHotels).toHaveBeenCalledTimes(1);
    // The LAX hotel must not be served for an SFO stay, nor kept in the SFO cache.
    expect(result.map((h) => h.id)).toEqual(["sfo-h1"]);
    expect(session.lastHotelResults.map((h) => h.id)).not.toContain("h1");
    expect(session.lastHotelSearchParams?.cityCode).toBe("SFO");
  });

  it("searches fresh when the traveler count changes for the same city and dates", async () => {
    deps.searchHotels = vi.fn(async () => [{ ...sampleHotelRaw, id: "h-party" }]);

    const session = freshSession();
    session.lastHotelSearchParams = { ...laxStay };
    session.lastHotelResults = [{ ...sampleHotelRaw, bookingLink: { url: "x", isDirect: true, note: "" } }];

    const orchestrator = createOrchestrator(deps);
    await orchestrator.__internal.runHotelSearch({ ...laxStay, travelers: 4 }, session);

    expect(deps.searchHotels).toHaveBeenCalledTimes(1);
    expect(session.lastHotelSearchParams?.travelers).toBe(4);
  });
});

function assistantToolCall(name: string, args: Record<string, unknown>, id = "call_1") {
  return {
    choices: [
      {
        message: {
          role: "assistant",
          content: null,
          tool_calls: [{ id, type: "function", function: { name, arguments: JSON.stringify(args) } }],
        },
      },
    ],
  };
}

function assistantText(content: string) {
  return { choices: [{ message: { role: "assistant", content, tool_calls: [] } }] };
}

describe("handleTurn tool-calling loop", () => {
  let deps: AgentDependencies;

  beforeEach(() => {
    createCompletion.mockReset();
    deps = {
      searchFlights: vi.fn(async () => [sampleRaw]),
      searchHotels: vi.fn(async () => [sampleHotelRaw]),
      buildFlightLink: vi.fn(() => ({ url: "https://example.com", isDirect: true, note: "" })),
      buildHotelLink: vi.fn(() => ({ url: "https://example.com", isDirect: true, note: "" })),
    };
  });

  it("runs a tool call, feeds the result back, and returns the model's final text", async () => {
    createCompletion
      .mockResolvedValueOnce(assistantToolCall("search_flights", jfkToLax))
      .mockResolvedValueOnce(assistantText("I found a Delta flight for $412.50."));

    const session = freshSession();
    const onStatus = vi.fn();
    const orchestrator = createOrchestrator(deps);

    const reply = await orchestrator.handleTurn(session, "JFK to LAX Nov 3-10 for 1", onStatus);

    expect(reply).toBe("I found a Delta flight for $412.50.");
    expect(deps.searchFlights).toHaveBeenCalledTimes(1);
    expect(onStatus).toHaveBeenCalledWith("Searching flights…");
    expect(createCompletion).toHaveBeenCalledTimes(2);

    // The tool result is fed back as a `tool` message keyed to the call id.
    const secondCallMessages = createCompletion.mock.calls[1][0].messages;
    const toolMessage = secondCallMessages.find(
      (m: { role: string }) => m.role === "tool"
    );
    expect(toolMessage.tool_call_id).toBe("call_1");
    expect(toolMessage.content).toContain("Delta Air Lines");

    // Offers are cached on the session for the UI table; the model only saw a summary.
    expect(session.lastFlightResults).toHaveLength(1);
    expect(session.messages.at(-1)).toEqual({
      role: "assistant",
      content: "I found a Delta flight for $412.50.",
    });
  });

  it("routes search_hotels tool calls to the injected hotel dependency", async () => {
    createCompletion
      .mockResolvedValueOnce(assistantToolCall("search_hotels", laxStay, "call_h"))
      .mockResolvedValueOnce(assistantText("Grand Plaza is $180/night."));

    const session = freshSession();
    const onStatus = vi.fn();
    const orchestrator = createOrchestrator(deps);

    const reply = await orchestrator.handleTurn(session, "hotels in LA", onStatus);

    expect(reply).toBe("Grand Plaza is $180/night.");
    expect(deps.searchHotels).toHaveBeenCalledTimes(1);
    expect(onStatus).toHaveBeenCalledWith("Searching hotels…");
    expect(session.lastHotelResults).toHaveLength(1);
  });

  it("degrades gracefully on a non-function (custom) tool call instead of crashing", async () => {
    // openai@7 types `tool_calls` as a union of function and custom tool calls; the
    // loop narrows on `call.type` before touching `.function`.
    createCompletion
      .mockResolvedValueOnce({
        choices: [
          {
            message: {
              role: "assistant",
              content: null,
              tool_calls: [{ id: "call_c", type: "custom", custom: { name: "weird", input: "{}" } }],
            },
          },
        ],
      })
      .mockResolvedValueOnce(assistantText("Sorry, I could not use that tool."));

    const session = freshSession();
    const orchestrator = createOrchestrator(deps);

    const reply = await orchestrator.handleTurn(session, "do something odd");

    expect(reply).toBe("Sorry, I could not use that tool.");
    expect(deps.searchFlights).not.toHaveBeenCalled();
    const toolMessage = createCompletion.mock.calls[1][0].messages.find(
      (m: { role: string }) => m.role === "tool"
    );
    expect(toolMessage.tool_call_id).toBe("call_c");
    expect(JSON.parse(toolMessage.content).error).toContain("Unsupported tool call type");
  });

  it("reports a failing tool back to the model rather than throwing out of handleTurn", async () => {
    deps.searchFlights = vi.fn(async () => {
      throw new Error("Amadeus 500");
    });
    createCompletion
      .mockResolvedValueOnce(assistantToolCall("search_flights", jfkToLax))
      .mockResolvedValueOnce(assistantText("The flight search is unavailable right now."));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const session = freshSession();
    const orchestrator = createOrchestrator(deps);

    const reply = await orchestrator.handleTurn(session, "JFK to LAX");

    expect(reply).toBe("The flight search is unavailable right now.");
    const toolMessage = createCompletion.mock.calls[1][0].messages.find(
      (m: { role: string }) => m.role === "tool"
    );
    expect(JSON.parse(toolMessage.content).error).toBe("Amadeus 500");
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it("records the fallback assistant turn in the transcript when the tool loop is exhausted", async () => {
    // The model never stops calling tools, so the loop runs out of iterations.
    createCompletion.mockResolvedValue(assistantToolCall("search_flights", jfkToLax));

    const session = freshSession();
    const orchestrator = createOrchestrator(deps);

    const reply = await orchestrator.handleTurn(session, "JFK to LAX");

    expect(reply).toBe("I found some results — check the table for details.");
    expect(createCompletion).toHaveBeenCalledTimes(4);
    // The turn must still appear in the transcript, otherwise the next turn's history
    // shows a user message with no assistant reply.
    expect(session.messages.at(-1)).toEqual({ role: "assistant", content: reply });
    expect(session.messages.filter((m) => m.role === "assistant")).toHaveLength(1);
  });
});
