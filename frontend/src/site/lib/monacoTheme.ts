/** Monaco themes matching the DataForge palette (site.css tokens). Registered once per page. */
type Monaco = typeof import("monaco-editor");
let defined = false;

export const FORGE_THEMES = { dark: "forge-dark", light: "forge-light" } as const;

export function defineForgeThemes(monaco: Monaco) {
  if (defined) return;
  defined = true;
  monaco.editor.defineTheme(FORGE_THEMES.dark, {
    base: "vs-dark" as const,
    inherit: true,
    rules: [
      { token: "keyword", foreground: "2dd4bf", fontStyle: "bold" },
      { token: "string", foreground: "fbbf24" },
      { token: "number", foreground: "a78bfa" },
      { token: "comment", foreground: "64748b", fontStyle: "italic" },
      { token: "predefined", foreground: "22d3ee" },
      { token: "operator", foreground: "94a3b8" },
    ],
    colors: {
      "editor.background": "#0b1120",
      "editor.foreground": "#e2e8f0",
      "editorLineNumber.foreground": "#475569",
      "editorLineNumber.activeForeground": "#94a3b8",
      "editor.lineHighlightBackground": "#121a2c",
      "editor.lineHighlightBorder": "#00000000",
      "editor.selectionBackground": "#2dd4bf33",
      "editorCursor.foreground": "#2dd4bf",
      "editorIndentGuide.background1": "#1e293b",
      "editorWidget.background": "#0d1321",
      "editorSuggestWidget.background": "#0d1321",
      "editorSuggestWidget.selectedBackground": "#1b263d",
    },
  });
  monaco.editor.defineTheme(FORGE_THEMES.light, {
    base: "vs" as const,
    inherit: true,
    rules: [
      { token: "keyword", foreground: "0f766e", fontStyle: "bold" },
      { token: "string", foreground: "92400e" },
      { token: "number", foreground: "6d28d9" },
      { token: "comment", foreground: "64748b", fontStyle: "italic" },
      { token: "predefined", foreground: "0e7490" },
    ],
    colors: {
      "editor.background": "#ffffff",
      "editor.lineHighlightBackground": "#f1f5f9",
      "editor.lineHighlightBorder": "#00000000",
      "editor.selectionBackground": "#0f766e26",
      "editorCursor.foreground": "#0f766e",
    },
  });
}
