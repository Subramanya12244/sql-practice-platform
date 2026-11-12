import { createContext, useContext } from "react";

export type HelpView = "section" | "center";

export interface OpenHelpOptions {
  /** Show this section instead of the one for the current page. */
  sectionId?: string;
  /** Scroll to this topic or control inside the section. */
  topicId?: string;
  view?: HelpView;
  /** Focus the search box. */
  search?: boolean;
}

export interface HelpApi {
  open: boolean;
  openHelp: (opts?: OpenHelpOptions) => void;
  closeHelp: () => void;
  toggleHelp: () => void;
  /** Start the guided tour of a section (default: the current page's). Navigates first when the tour belongs to another page. */
  startTour: (sectionId?: string) => void;
  /** Show the first-visit welcome card again. */
  replayWelcome: () => void;
}

export const HelpContext = createContext<HelpApi | null>(null);

/** Null outside the provider (e.g. an isolated component test); help UI then simply hides its actions. */
export const useHelpOptional = () => useContext(HelpContext);

export function useHelp(): HelpApi {
  const ctx = useContext(HelpContext);
  if (!ctx) throw new Error("useHelp outside HelpProvider");
  return ctx;
}
