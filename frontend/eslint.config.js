import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";

/** Deliberately small: only rules that catch real runtime bugs (hooks misuse). Style is not enforced. */
export default [
  { linterOptions: { reportUnusedDisableDirectives: "off" } },
  { ignores: ["dist/**", "dist-site/**", "node_modules/**", "smoke/**", "scripts/**", "e2e/**", "*.config.*"] },
  {
    files: ["src/**/*.{ts,tsx}"],
    languageOptions: { parser: tseslint.parser, parserOptions: { ecmaFeatures: { jsx: true } } },
    plugins: { "react-hooks": reactHooks, "@typescript-eslint": tseslint.plugin },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "off",
    },
  },
];
