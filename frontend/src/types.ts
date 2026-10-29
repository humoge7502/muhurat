export interface Opportunity {
  id: string;
  source: string;
  type: "contest" | "hackathon" | "scholarship";
  title: string;
  org: string | null;
  url: string;
  region: string | null;
  starts_at: string | null;
  deadline: string | null;
  deadline_is_estimate: number;
  prize: string | null;
  tags: string[];
  excerpt: string | null;
  fetched_at: string;
}

export interface SourceStatus {
  source: string;
  last_fetch: string | null;
  last_ok: string | null;
  last_count: number | null;
  last_error: string | null;
}

export interface OpportunitiesResponse {
  count: number;
  items: Opportunity[];
  sources: SourceStatus[];
}
