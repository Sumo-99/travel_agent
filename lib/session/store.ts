import { randomUUID } from "crypto";
import { cookies } from "next/headers";
import type { SessionState } from "@/types/travel";

const SESSION_COOKIE = "trip_session_id";
const sessions = new Map<string, SessionState>();

function freshState(sessionId: string): SessionState {
  return {
    sessionId,
    messages: [],
    lastFlightResults: [],
    lastHotelResults: [],
    displayedFlights: [],
    displayedHotels: [],
    lastFlightSearchParams: null,
    lastHotelSearchParams: null,
  };
}

export function getSession(sessionId: string): SessionState {
  const existing = sessions.get(sessionId);
  if (existing) return existing;
  const created = freshState(sessionId);
  sessions.set(sessionId, created);
  return created;
}

export function updateSession(sessionId: string, patch: Partial<SessionState>): void {
  const current = getSession(sessionId);
  sessions.set(sessionId, { ...current, ...patch });
}

// NOTE: Next.js 15+ made `cookies()` from `next/headers` an async API
// (it returns `Promise<ReadonlyRequestCookies>`); this project is on
// Next.js 16.3.4, which requires awaiting it. The brief's original sample
// called `cookies()` synchronously — that signature no longer works, so
// this function is `async` and returns `Promise<string>`. Callers (e.g.
// the API route added in Task 5) must `await getOrCreateSessionId()`.
export async function getOrCreateSessionId(): Promise<string> {
  const store = await cookies();
  const existing = store.get(SESSION_COOKIE)?.value;
  if (existing) {
    getSession(existing);
    return existing;
  }
  const id = randomUUID();
  store.set(SESSION_COOKIE, id, { httpOnly: true, sameSite: "lax", path: "/" });
  getSession(id);
  return id;
}
