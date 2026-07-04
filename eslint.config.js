import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-require-imports": "off",
      "no-console": "off",
      "no-undef": "off", // TypeScript handles this
    },
  },
  {
    // src/ui/views/ holds browser-side view code (plain JS bundled by
    // scripts/build-ui.mjs), not Node/TypeScript sources.
    ignores: ["dist/", "node_modules/", "coverage/", "src/ui/views/"],
  }
);
