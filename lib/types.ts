export interface Source {
  id: string;
  name: string;
  rss_url: string;
  home_url: string;
  language: string;
  created_at: string;
}

export interface Article {
  id: string;
  source_id: string;
  url: string;
  headline: string;
  body: string | null;
  summary: string | null;
  image_url: string | null;
  published_at: string | null;
  ingested_at: string;
  topic_tags: string[];
  identity_score: number | null;
  state_trust_score: number | null;
  economic_score: number | null;
  institution_score: number | null;
  sources?: Pick<Source, "id" | "name" | "home_url" | "language">;
  // Populated by feed query join (Build 3C)
  cluster_id?: string | null;
  cluster_source_count?: number | null;
}

export const TOPICS = [
  { id: "politics",       label: "Politics" },
  { id: "economy",        label: "Economy" },
  { id: "judiciary",      label: "Judiciary" },
  { id: "foreign-policy", label: "Foreign policy" },
  { id: "environment",    label: "Environment" },
  { id: "science-tech",   label: "Science & Tech" },
  { id: "health",         label: "Health" },
  { id: "sports",         label: "Sports" },
  { id: "education",      label: "Education" },
  { id: "society",        label: "Society" },
  { id: "business",       label: "Business" },
  { id: "defence",        label: "Defence" },
] as const;

export type TopicId = typeof TOPICS[number]["id"];
