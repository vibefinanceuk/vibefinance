// The check for docs/decisions/0001-worker-split-and-tenant-resolution.md:
// "advice does not hold a line, a check does." No query site may reach
// `env.DB` (or any other tenant-scoped binding) directly. Everything goes
// through resolveTenant() in shared/tenant.ts. shared/tenant.ts itself is
// exempt — it is the one place the binding is legitimately touched.
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import globals from "globals";

const bannedBindings = ["DB", "TENANT_DB", "TENANT_KV", "DOCUMENTS"];

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
    rules: {
      // An underscore-prefixed parameter is intentionally unused
      // (e.g. Workers handler signatures like `scheduled(_event, env,
      // _ctx)` where the platform requires the parameter but this
      // Worker doesn't need it yet). This was working by accident
      // until now — ESLint's default "after-used" behaviour only flags
      // an unused arg if nothing *after* it is used, so `_event`
      // before a used `env` was silently fine while a trailing unused
      // `_ctx` was not. Explicit is better than relying on which
      // position happens to be silent.
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
    },
  },
  {
    // scripts/ runs under plain Node (the operator's machine), not the
    // Workers runtime — process, console, TextEncoder etc. are real
    // globals there, not undefined names.
    files: ["scripts/**/*.{js,mjs,ts}"],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
  {
    // .cjs specifically: package.json sets "type": "module", so a build
    // script needing require() — the docx library is CommonJS — has to
    // carry that extension. require and module are legitimate globals
    // there, and the ES-import rule does not apply.
    files: ["scripts/**/*.cjs"],
    languageOptions: {
      sourceType: "commonjs",
      globals: { ...globals.node },
    },
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },
  {
    // vf-ui's public/ is browser code, not Worker code: window,
    // document and fetch are real globals there. Kept as its own block
    // rather than widening the Worker config, so a Worker file cannot
    // quietly start using a browser global and pass.
    files: ["workers/vf-ui/public/**/*.js"],
    languageOptions: {
      globals: { ...globals.browser },
      sourceType: "module",
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
