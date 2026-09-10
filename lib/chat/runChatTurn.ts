import type { FlightOffer, HotelOffer, TripFormInput } from "@/types/travel";

export interface ChatTurnBody {
  message?: string;
  formData?: TripFormInput;
}

export interface ChatTurnCallbacks {
  onStatus: (text: string) => void;
  onFinal: (text: string, flights: FlightOffer[], hotels: HotelOffer[]) => void;
  onError: (text: string) => void;
}

/**
 * Shared client-side POST /api/chat + newline-delimited-JSON stream reader, used by
 * both ChatPanel's chat-initiated turns and page.tsx's form-submitted turns (Critical
 * #2's fix lifts message display to a common shape so both paths render into the same
 * chat transcript; this function is the single place that reads the stream so Important
 * #4's chunk-boundary/error-handling fix only needs to live once).
 *
 * Never throws — all failure paths (network error, non-2xx response, a JSON.parse
 * failure on one line) are reported via `callbacks.onError` so the caller's busy-flag
 * reset (which the caller should do in a `finally`) is never skipped.
 */
export async function runChatTurn(body: ChatTurnBody, callbacks: ChatTurnCallbacks): Promise<void> {
  let res: Response;
  try {
    res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (err) {
    callbacks.onError(err instanceof Error ? err.message : "Network error contacting the server");
    return;
  }

  if (!res.ok) {
    callbacks.onError(`Request failed (HTTP ${res.status})`);
    return;
  }

  const reader = res.body?.getReader();
  if (!reader) {
    callbacks.onError("No response stream from server");
    return;
  }

  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // Only consume complete lines. A payload can legitimately split across TCP
      // chunks (e.g. the `final` message carrying up to 20 offers) — keep the
      // trailing incomplete fragment in `buffer` for the next chunk instead of
      // discarding it.
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.trim()) continue;
        let payload: { type?: string; text?: string; flights?: FlightOffer[]; hotels?: HotelOffer[] };
        try {
          payload = JSON.parse(line);
        } catch (err) {
          console.error("[runChatTurn] failed to parse stream line", err, line);
          continue;
        }

        if (payload.type === "status") {
          callbacks.onStatus(payload.text ?? "");
        } else if (payload.type === "final") {
          callbacks.onFinal(payload.text ?? "", payload.flights ?? [], payload.hotels ?? []);
        } else if (payload.type === "error") {
          callbacks.onError(payload.text ?? "Unknown error");
        }
      }
    }
  } catch (err) {
    callbacks.onError(err instanceof Error ? err.message : "Error reading response stream");
  }
}
