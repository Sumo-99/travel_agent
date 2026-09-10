import OpenAI from "openai";
import type {
  ChatMessage,
  FlightOffer,
  HotelOffer,
  LastFlightSearchParams,
  RawFlightOffer,
  RawHotelOffer,
  SearchFlightsToolArgs,
  SearchHotelsToolArgs,
  SessionState,
} from "@/types/travel";
import { searchFlightsToolSchema, searchHotelsToolSchema } from "@/lib/agent/tools";

/**
 * Task 4 is dependency-injected by design: nothing here imports `lib/amadeus/*`
 * or `lib/links/*`. Task 5 wires the concrete implementations in.
 */
export interface AgentDependencies {
  searchFlights: (args: SearchFlightsToolArgs) => Promise<RawFlightOffer[]>;
  searchHotels: (args: SearchHotelsToolArgs) => Promise<RawHotelOffer[]>;
  buildFlightLink: (offer: RawFlightOffer) => FlightOffer["bookingLink"];
  buildHotelLink: (offer: RawHotelOffer) => HotelOffer["bookingLink"];
}

export type StatusCallback = (status: string) => void;

export interface FlightSearchArgs extends LastFlightSearchParams {
  maxPriceUSD?: number;
  maxStops?: number;
}

export interface HotelSearchArgs {
  cityCode: string;
  checkInDate: string;
  checkOutDate: string;
  travelers: number;
  maxPricePerNightUSD?: number;
  minStarRating?: number;
}

const MODEL = "nvidia/nemotron-3.5-lightning:free";
const MAX_TOOL_ITERATIONS = 4;
const MAX_RESULTS = 10;

const SYSTEM_PROMPT: ChatMessage = {
  role: "system",
  content:
    "You are a US-domestic flight and hotel search assistant. Always call search_flights and/or " +
    "search_hotels with the full known criteria before answering with results. If required trip " +
    "details are missing (origin, destination, dates, travelers, cabin class for flights; dates " +
    "and city for hotels), ask one concise clarifying question instead of calling a tool. Never " +
    "invent prices or availability yourself — only report what a tool returned.",
};

function sameRoute(a: FlightSearchArgs, cached: LastFlightSearchParams | null): boolean {
  if (!cached) return false;
  return (
    a.origin === cached.origin &&
    a.destination === cached.destination &&
    a.departureDate === cached.departureDate &&
    a.returnDate === cached.returnDate &&
    a.travelers === cached.travelers &&
    a.cabinClass === cached.cabinClass
  );
}

function filterFlights(offers: FlightOffer[], args: FlightSearchArgs): FlightOffer[] {
  return offers.filter((o) => {
    if (args.maxPriceUSD !== undefined && o.priceUSD > args.maxPriceUSD) return false;
    if (args.maxStops !== undefined && o.stops > args.maxStops) return false;
    return true;
  });
}

function filterHotels(offers: HotelOffer[], args: HotelSearchArgs): HotelOffer[] {
  return offers.filter((o) => {
    if (args.maxPricePerNightUSD !== undefined && o.pricePerNightUSD > args.maxPricePerNightUSD) return false;
    if (args.minStarRating !== undefined && (o.starRating ?? 0) < args.minStarRating) return false;
    return true;
  });
}

export function createOrchestrator(deps: AgentDependencies) {
  /**
   * Cache-first refinement: if the caller is only tightening filters on a route we
   * already searched, answer from `session.lastFlightResults` without a network call.
   * Otherwise search fresh, merge + dedupe by id, re-rank by price, then filter.
   */
  async function runFlightSearch(args: FlightSearchArgs, session: SessionState): Promise<FlightOffer[]> {
    if (sameRoute(args, session.lastFlightSearchParams) && session.lastFlightResults.length > 0) {
      const filtered = filterFlights(session.lastFlightResults, args);
      if (filtered.length > 0) return filtered.slice(0, MAX_RESULTS);
    }

    const raw = await deps.searchFlights({
      origin: args.origin,
      destination: args.destination,
      departureDate: args.departureDate,
      returnDate: args.returnDate,
      travelers: args.travelers,
      cabinClass: args.cabinClass,
      maxResults: MAX_RESULTS,
    });
    const fresh: FlightOffer[] = raw.map((r) => ({ ...r, bookingLink: deps.buildFlightLink(r) }));

    const merged = new Map<string, FlightOffer>();
    for (const o of session.lastFlightResults) merged.set(o.id, o);
    for (const o of fresh) merged.set(o.id, o);
    const reranked = Array.from(merged.values()).sort((a, b) => a.priceUSD - b.priceUSD);

    session.lastFlightResults = reranked;
    session.lastFlightSearchParams = {
      origin: args.origin,
      destination: args.destination,
      departureDate: args.departureDate,
      returnDate: args.returnDate,
      travelers: args.travelers,
      cabinClass: args.cabinClass,
    };

    return filterFlights(reranked, args).slice(0, MAX_RESULTS);
  }

  async function runHotelSearch(args: HotelSearchArgs, session: SessionState): Promise<HotelOffer[]> {
    const cached = session.lastHotelResults;
    const cachedMatchesRoute =
      cached.length > 0 && cached[0].checkInDate === args.checkInDate && cached[0].checkOutDate === args.checkOutDate;

    if (cachedMatchesRoute) {
      const filtered = filterHotels(cached, args);
      if (filtered.length > 0) return filtered.slice(0, MAX_RESULTS);
    }

    const raw = await deps.searchHotels({
      cityCode: args.cityCode,
      checkInDate: args.checkInDate,
      checkOutDate: args.checkOutDate,
      travelers: args.travelers,
      maxResults: MAX_RESULTS,
    });
    const fresh: HotelOffer[] = raw.map((r) => ({ ...r, bookingLink: deps.buildHotelLink(r) }));

    const merged = new Map<string, HotelOffer>();
    for (const o of cached) merged.set(o.id, o);
    for (const o of fresh) merged.set(o.id, o);
    const reranked = Array.from(merged.values()).sort((a, b) => a.pricePerNightUSD - b.pricePerNightUSD);

    session.lastHotelResults = reranked;

    return filterHotels(reranked, args).slice(0, MAX_RESULTS);
  }

  async function handleTurn(
    session: SessionState,
    userMessage: string,
    onStatus?: StatusCallback
  ): Promise<string> {
    const client = new OpenAI({
      apiKey: process.env.OPENROUTER_API_KEY,
      baseURL: "https://openrouter.ai/api/v1",
    });

    session.messages.push({ role: "user", content: userMessage });

    const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      { role: SYSTEM_PROMPT.role, content: SYSTEM_PROMPT.content },
      ...session.messages.map(
        (m) => ({ role: m.role, content: m.content }) as OpenAI.Chat.Completions.ChatCompletionMessageParam
      ),
    ];

    let finalText = "";

    for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration++) {
      const completion = await client.chat.completions.create({
        model: MODEL,
        messages,
        tools: [searchFlightsToolSchema, searchHotelsToolSchema],
        tool_choice: "auto",
      });

      const choice = completion.choices[0];
      const toolCalls = choice?.message?.tool_calls ?? [];

      if (toolCalls.length === 0) {
        finalText = choice?.message?.content ?? "";
        session.messages.push({ role: "assistant", content: finalText });
        break;
      }

      messages.push(choice.message);

      for (const call of toolCalls) {
        // openai@7 models `tool_calls` as a union of function and custom tool calls,
        // so narrow on the discriminant before touching `.function`.
        if (call.type !== "function") {
          messages.push({
            role: "tool",
            tool_call_id: call.id,
            content: JSON.stringify({ error: `Unsupported tool call type ${call.type}` }),
          });
          continue;
        }

        let resultSummary: string;
        try {
          const args = JSON.parse(call.function.arguments || "{}");

          if (call.function.name === "search_flights") {
            onStatus?.("Searching flights…");
            const offers = await runFlightSearch(args as FlightSearchArgs, session);
            resultSummary = JSON.stringify(
              offers.map((o) => ({ id: o.id, airline: o.airline, priceUSD: o.priceUSD, stops: o.stops }))
            );
          } else if (call.function.name === "search_hotels") {
            onStatus?.("Searching hotels…");
            const offers = await runHotelSearch(args as HotelSearchArgs, session);
            resultSummary = JSON.stringify(
              offers.map((o) => ({
                id: o.id,
                name: o.name,
                pricePerNightUSD: o.pricePerNightUSD,
                starRating: o.starRating,
              }))
            );
          } else {
            resultSummary = JSON.stringify({ error: `Unknown tool ${call.function.name}` });
          }
        } catch (err) {
          resultSummary = JSON.stringify({
            error: err instanceof Error ? err.message : "Tool execution failed",
          });
        }

        messages.push({ role: "tool", tool_call_id: call.id, content: resultSummary });
      }
    }

    return finalText || "I found some results — check the table for details.";
  }

  return { handleTurn, __internal: { runFlightSearch, runHotelSearch } };
}

export type Orchestrator = ReturnType<typeof createOrchestrator>;
