// Vite serves any module with ?raw as its source text. Declared here so
// the type-checker knows, matching workers/*/test/raw-imports.d.ts.
//
// Used by interpreter/field-coverage.test.ts to read the UBL parser's
// own source and assert that every field the vocabulary declares can be
// populated by some intake path — a check that has to cross the boundary
// between the two files to mean anything.
declare module "*.ts?raw" {
  const content: string;
  export default content;
}
