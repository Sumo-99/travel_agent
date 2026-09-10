import { NextRequest } from "next/server";
import { getOrCreateSessionId, getSession } from "@/lib/session/store";
import { createOrchestrator } from "@/lib/agent/orchestrator";
import { searchFlights } from "@/lib/amadeus/flights";
import { searchHotels } from "@/lib/amadeus/hotels";
import { buildFlightLink } from "@/lib/links/flightLink";
import { buildHotelLink } from "@/lib/links/hotelLink";
import type { TripFormInput } from "@/types/travel";

const orchestrator = createOrchestrator({ searchFlights, searchHotels, buildFlightLink, buildHotelLink });

function formToMessage(form: TripFormInput): string {
  return (
    `Find round-trip domestic US flights from ${form.origin} to ${form.destination}, departing ` +
    `${form.departureDate} and returning ${form.returnDate}, for ${form.travelers} traveler(s) in ` +
    `${form.cabinClass} cabin class. Also find hotels in ${form.destination} for the same dates.`
  );
}

export async function POST(req: NextRequest) {
  const sessionId = await getOrCreateSessionId();
  const session = getSession(sessionId);
  const body = (await req.json()) as { message?: string; formData?: TripFormInput };
  const userMessage = body.formData ? formToMessage(body.formData) : body.message ?? "";

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      const emit = (payload: unknown) => controller.enqueue(encoder.encode(JSON.stringify(payload) + "\n"));

      try {
        // handleTurn pushes the final assistant message onto session.messages itself
        // (on every exit path, including the max-iteration fallback) — its return
        // value here is only for streaming to the client, not for us to re-push.
        const finalText = await orchestrator.handleTurn(session, userMessage, (status) =>
          emit({ type: "status", text: status })
        );
        emit({
          type: "final",
          text: finalText,
          flights: session.lastFlightResults.slice(0, 10),
          hotels: session.lastHotelResults.slice(0, 10),
        });
      } catch (err) {
        emit({ type: "error", text: err instanceof Error ? err.message : "Unknown error" });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
}
