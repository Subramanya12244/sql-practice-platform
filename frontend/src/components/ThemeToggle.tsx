import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme, type ThemePreference } from "../contexts/ThemeContext";

const OPTIONS: { value: ThemePreference; label: string; icon: typeof Sun }[] = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Monitor },
];

export function ThemeToggle({ compact = false }: { compact?: boolean }) {
  const { preference, setPreference } = useTheme();

  return (
    <div
      className="inline-flex items-center rounded-xl border border-surface-border bg-surface-overlay/70 p-0.5"
      role="group"
      aria-label="Color theme"
    >
      {OPTIONS.map(({ value, label, icon: Icon }) => {
        const active = preference === value;
        return (
          <button
            key={value}
            type="button"
            title={label}
            aria-label={label}
            aria-pressed={active}
            onClick={() => setPreference(value)}
            className={`inline-flex items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-[11px] font-medium transition duration-fast ${
              active
                ? "bg-surface-raised text-ink shadow-sm ring-1 ring-surface-border"
                : "text-ink-faint hover:text-ink"
            }`}
          >
            <Icon className="h-3.5 w-3.5 shrink-0" />
            {!compact && <span className="hidden sm:inline">{label}</span>}
          </button>
        );
      })}
    </div>
  );
}
