import registry from "../content/tracks.json";

export interface TrackTopic {
  slug: string;
  title: string;
}
export interface Track {
  id: string;
  title: string;
  description: string;
  order: number;
  mindmap: string;
  topics: TrackTopic[];
}
export interface ProjectRef {
  slug: string;
  title: string;
  level: string;
}

/** The SQL track is the existing notes library; the others come from tracks.json. */
export const SQL_TRACK: Track = {
  id: "sql",
  title: "SQL",
  description: "Queries from SELECT to window functions, plus PostgreSQL internals, indexing and design.",
  order: 1,
  mindmap: "sql-roadmap",
  topics: [],
};

export const TRACKS: Track[] = (registry.tracks as Track[]).slice().sort((a, b) => a.order - b.order);
export const PROJECT_REFS: ProjectRef[] = registry.projects as ProjectRef[];
export const trackOf = (noteCategory: string) => TRACKS.find((t) => t.id === noteCategory);
