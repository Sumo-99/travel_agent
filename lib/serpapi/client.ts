const SERPAPI_BASE_URL = "https://serpapi.com/search.json";

interface SerpApiErrorShape {
  error?: string;
}

export async function serpApiGet<T>(params: Record<string, string>): Promise<T> {
  const query = new URLSearchParams({
    ...params,
    api_key: process.env.SERPAPI_API_KEY ?? "",
  }).toString();

  const response = await fetch(`${SERPAPI_BASE_URL}?${query}`);
  if (!response.ok) {
    throw new Error(`SerpApi request failed: ${response.status} ${await response.text()}`);
  }

  const data = (await response.json()) as T & SerpApiErrorShape;
  if (data.error) {
    throw new Error(data.error);
  }

  return data;
}
