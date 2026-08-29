// The check for docs/decisions/0001-worker-split-and-tenant-resolution.md:
// "advice does not hold a line, a check does." No query site may reach
// `env.DB` (or any other tenant-scoped binding) directly. Everything goes
// through resolveTenant() in shared/tenant.ts. shared/tenant.ts itself is
// exempt — it is the one place the binding is legitimately touched.
import js from "@eslint/js";
import tseslint from "typescript-eslint";

const bannedBindings = ["DB", "TENANT_DB", "TENANT_KV"];

export default [
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    ignores: ["**/dist/**", "**/node_modules/**", "**/*.d.ts"],
  },
  {
    files: ["**/*.ts"],
    languageOptions: {
      parserOptions: {
        // Type-aware rules are not needed for this check; project-less
        // parsing keeps lint fast and avoids wiring a tsconfig per
        // workspace just to satisfy the linter.
        projectService: false,
      },
    },
  },
  {
    // src only — test setup code legitimately seeds env.DB directly to
    // prepare fixtures, which is not the thing this check guards against.
    files: ["workers/**/src/**/*.{js,ts}"],
    rules: {
      "no-restricted-properties": [
        "error",
        ...bannedBindings.map((prop) => ({
          object: "env",
          property: prop,
          message:
            `Do not read env.${prop} directly. Call resolveTenant(request, env) ` +
            `from shared/tenant.ts — see docs/decisions/0001-worker-split-and-tenant-resolution.md. ` +
            `Reaching for the binding directly silently commits to one-Worker-per-tenant deployment.`,
        })),
      ],
    },
  },
  {
    files: ["shared/tenant.{js,ts}"],
    rules: {
      "no-restricted-properties": "off",
    },
  },
];
