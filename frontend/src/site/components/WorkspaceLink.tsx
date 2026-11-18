import { Link } from "react-router-dom";
import { PanelsTopLeft } from "lucide-react";

/** Link to the unified exercise workspace for one exercise id (sql:<slug>, py:<slug>, daily:<day>#<id>). */
export function workspaceUrl(id: string): string {
  return `/workspace?e=${encodeURIComponent(id)}`;
}

export function WorkspaceLink({ id, className = "" }: { id: string; className?: string }) {
  return (
    <Link
      to={workspaceUrl(id)}
      data-testid="open-in-workspace"
      className={`inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-sm font-medium text-accent hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent ${className}`}
    >
      <PanelsTopLeft className="h-4 w-4" aria-hidden /> Open in workspace
    </Link>
  );
}
