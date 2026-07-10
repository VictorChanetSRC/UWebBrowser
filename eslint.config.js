import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

/**
 * `tsc` already catches the type errors; this catches the ones a type system
 * can't see. The rule that earns its keep is `react-hooks/exhaustive-deps`:
 * this app is a browser, so a stale closure in an effect means a tab that
 * navigates to the wrong URL or a zoom that lands on the wrong host. Where an
 * effect really must not re-run, say so with a disable comment and a reason.
 *
 * `react-refresh/only-export-components` is deliberately absent: a widget is
 * one file that exports its stored type, its spec and its body together (see
 * docs/WIDGETS.md), which is exactly what that rule forbids. It would fire 53
 * times against a documented design, and warnings nobody can act on train
 * people to ignore the ones that matter.
 */
export default tseslint.config(
  { ignores: ["dist", "src-tauri/target"] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
    },
    plugins: { "react-hooks": reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // A leading underscore is how this codebase spells "required by the
      // signature, unused by this implementation" (e.g. unused widget props).
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  {
    // Vite's config (which carries the Vitest one) runs in Node.
    files: ["*.config.{js,ts}"],
    languageOptions: { globals: globals.node },
  },
);
