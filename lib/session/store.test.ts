// lib/session/store.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { getSession, updateSession } from "@/lib/session/store";

describe("session store", () => {
  it("creates a fresh session with empty state on first access", () => {
    const session = getSession("test-session-1");
    expect(session.sessionId).toBe("test-session-1");
    expect(session.messages).toEqual([]);
    expect(session.lastFlightResults).toEqual([]);
    expect(session.lastFlightSearchParams).toBeNull();
  });

  it("persists patches across calls for the same session id", () => {
    getSession("test-session-2");
    updateSession("test-session-2", { messages: [{ role: "user", content: "hi" }] });
    const session = getSession("test-session-2");
    expect(session.messages).toEqual([{ role: "user", content: "hi" }]);
  });
});
