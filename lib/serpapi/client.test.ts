import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { serpApiGet } from "@/lib/serpapi/client";

describe("serpApiGet", () => {
  const originalFetch = global.fetch;
  const originalApiKey = process.env.SERPAPI_API_KEY;

  beforeEach(() => {
    process.env.SERPAPI_API_KEY = "test-key";
  });

  afterEach(() => {
    global.fetch = originalFetch;
    if (originalApiKey === undefined) {
      delete process.env.SERPAPI_API_KEY;
    } else {
      process.env.SERPAPI_API_KEY = originalApiKey;
    }
    vi.restoreAllMocks();
  });

  it("appends the api_key and returns parsed JSON on success", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ hello: "world" }),
    }) as unknown as typeof fetch;

    const result = await serpApiGet<{ hello: string }>({ engine: "google_flights" });

    expect(result).toEqual({ hello: "world" });
    const calledUrl = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(calledUrl).toContain("api_key=test-key");
    expect(calledUrl).toContain("engine=google_flights");
  });

  it("throws when SerpApi returns an error field", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ error: "Invalid API key" }),
    }) as unknown as typeof fetch;

    await expect(serpApiGet({ engine: "google_flights" })).rejects.toThrow("Invalid API key");
  });

  it("throws when the HTTP response is not ok", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => "server error",
    }) as unknown as typeof fetch;

    await expect(serpApiGet({ engine: "google_flights" })).rejects.toThrow(
      "SerpApi request failed: 500 server error",
    );
  });
});
