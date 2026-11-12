import type { GlossaryEntry, HelpSection } from "./types";

type Registry = typeof import("./registry");
let loading: Promise<Registry> | null = null;

/** Help content is code-split: nothing is downloaded until a learner opens help, a tooltip or search. */
export const loadRegistry = (): Promise<Registry> => (loading ??= import("./registry"));

export type { GlossaryEntry, HelpSection };
