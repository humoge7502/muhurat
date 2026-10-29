import type { OpportunitiesResponse } from "./types";

async function get<T>(path: string): Promise<T> {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return (await response.json()) as T;
}

export const api = {
  opportunities: (params: string) => get<OpportunitiesResponse>(`/api/opportunities${params}`),
  refresh: async () => {
    const response = await fetch("/api/refresh", { method: "POST" });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    return (await response.json()) as {
      results: Record<string, { ok: boolean; count?: number; error?: string }>;
    };
  },
};
