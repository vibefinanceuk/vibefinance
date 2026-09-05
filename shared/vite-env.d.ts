/**
 * Vite's own types, for the two places a test reads a real file.
 *
 * `shared` is a Workers package with no Node types, so a test wanting
 * the migration chain reads it through `import.meta.glob` rather than
 * `node:fs`. Without this the code runs under vitest and fails `tsc` —
 * which decision 0100 records as the worst kind of check: one that
 * passes in the place nobody is looking.
 */
/// <reference types="vite/client" />
