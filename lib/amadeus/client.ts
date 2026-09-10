const AMADEUS_BASE_URL = process.env.AMADEUS_BASE_URL ?? "https://test.api.amadeus.com";

interface CachedToken {
  value: string;
  expiresAt: number;
}

let cachedToken: CachedToken | null = null;

export async function getAccessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now()) {
    return cachedToken.value;
  }
  const res = await fetch(`${AMADEUS_BASE_URL}/v1/security/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: process.env.AMADEUS_CLIENT_ID ?? "",
      client_secret: process.env.AMADEUS_CLIENT_SECRET ?? "",
    }),
  });
  if (!res.ok) {
    throw new Error(`Amadeus auth failed: ${res.status} ${await res.text()}`);
  }
  const data = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = { value: data.access_token, expiresAt: Date.now() + (data.expires_in - 60) * 1000 };
  return cachedToken.value;
}

export async function amadeusGet<T>(path: string, params: Record<string, string>): Promise<T> {
  const token = await getAccessToken();
  const query = new URLSearchParams(params).toString();
  const res = await fetch(`${AMADEUS_BASE_URL}${path}?${query}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new Error(`Amadeus request failed: ${res.status} ${await res.text()}`);
  }
  return (await res.json()) as T;
}
