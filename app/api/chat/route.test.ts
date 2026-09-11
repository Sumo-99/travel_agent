import { afterEach, describe, expect, it, vi } from "vitest";

const { handleTurn, session } = vi.hoisted(() => ({
  handleTurn: vi.fn(),
  session: {
    displayedFlights: [],
    displayedHotels: [],
  },
}));

vi.mock("@/lib/session/store", () => ({
  getOrCreateSessionId: vi.fn(async () => "s1"),
  getSession: vi.fn(() => session),
}));

vi.mock("@/lib/agent/orchestrator", () => ({
  createOrchestrator: vi.fn(() => ({ handleTurn })),
}));

vi.mock("@/lib/serpapi/flights", () => ({ searchFlights: vi.fn() }));
vi.mock("@/lib/serpapi/hotels", () => ({ searchHotels: vi.fn() }));
vi.mock("@/lib/links/flightLink", () => ({ buildFlightLink: vi.fn() }));
vi.mock("@/lib/links/hotelLink", () => ({ buildHotelLink: vi.fn() }));

import { POST } from "@/app/api/chat/route";

describe("POST /api/chat", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("silently ignores status emissions after the response reader is cancelled", async () => {
    let releaseTurn!: () => void;
    const turnMayContinue = new Promise<void>((resolve) => {
      releaseTurn = resolve;
    });
    let firstStatusSent!: () => void;
    const firstStatus = new Promise<void>((resolve) => {
      firstStatusSent = resolve;
    });
    let turnFinished!: () => void;
    const finished = new Promise<void>((resolve) => {
      turnFinished = resolve;
    });

    handleTurn.mockImplementationOnce(async (_session, _message, onStatus) => {
      try {
        onStatus("Searching flights…");
        firstStatusSent();
        await turnMayContinue;
        onStatus("Searching hotels…");
        return "Finished";
      } finally {
        turnFinished();
      }
    });
    const enqueueSpy = vi.spyOn(ReadableStreamDefaultController.prototype, "enqueue");
    const request = new Request("http://localhost/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "Plan a trip" }),
    });

    const response = await POST(request as never);
    const reader = response.body!.getReader();
    await firstStatus;
    await reader.cancel();
    releaseTurn();
    await finished;
    await Promise.resolve();

    expect(handleTurn).toHaveBeenCalledTimes(1);
    expect(enqueueSpy).toHaveBeenCalledTimes(1);
  });
});
