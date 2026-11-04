import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../services/api";
import type { Project } from "../types";

const STORAGE_KEY = "sqlp.activeProjectId";

interface ProjectContextValue {
  projects: Project[];
  activeProjectId: number | null;
  activeProject: Project | null;
  setActiveProjectId: (id: number | null) => void;
  isLoading: boolean;
}

const ProjectContext = createContext<ProjectContextValue | null>(null);

function readStored(): number | null {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

export function ProjectProvider({ children }: { children: React.ReactNode }) {
  const [activeProjectId, setActiveId] = useState<number | null>(readStored);

  const { data, isLoading } = useQuery({
    queryKey: ["projects"],
    queryFn: api.listProjects,
  });

  const projects = useMemo(() => data?.projects ?? [], [data]);

  // A project can be deleted from another tab, so drop stale selections.
  useEffect(() => {
    if (activeProjectId == null || isLoading) return;
    if (!projects.some((p) => p.id === activeProjectId)) {
      setActiveId(null);
      localStorage.removeItem(STORAGE_KEY);
    }
  }, [projects, activeProjectId, isLoading]);

  const setActiveProjectId = useCallback((id: number | null) => {
    setActiveId(id);
    if (id == null) localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, String(id));
  }, []);

  const value = useMemo<ProjectContextValue>(
    () => ({
      projects,
      activeProjectId,
      activeProject: projects.find((p) => p.id === activeProjectId) ?? null,
      setActiveProjectId,
      isLoading,
    }),
    [projects, activeProjectId, setActiveProjectId, isLoading],
  );

  return <ProjectContext.Provider value={value}>{children}</ProjectContext.Provider>;
}

export function useProject(): ProjectContextValue {
  const ctx = useContext(ProjectContext);
  if (!ctx) throw new Error("useProject must be used inside a ProjectProvider");
  return ctx;
}
