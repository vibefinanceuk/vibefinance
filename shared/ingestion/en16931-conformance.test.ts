import { describe, expect, it } from "vitest";
import { EN16931_RULES } from "./en16931-rules.js";
import { readInvoiceXml } from "./invoice-xml.js";

/**
 * **The official EN 16931 tests as the yardstick** — decision 0560.
 *
 * CEN's validation artefacts (github.com/ConnectingEurope/eInvoicing-EN16931)
 * include a unit test per business rule: small UBL fragments, each
 * asserting that a rule succeeds or fails on it. Our rules are written in
 * TypeScript rather than run from their Schematron, and these tests are
 * how we know the two agree.
 *
 * **Not copied into this repository.** The artefacts are EUPL 1.2, and
 * vendoring them would bring that licence with them. So this suite reads
 * them from a local clone named by `EN16931_ARTEFACTS`, and is skipped
 * where there is none:
 *
 *     git clone --depth 1 https://github.com/ConnectingEurope/eInvoicing-EN16931.git /tmp/en16931
 *     EN16931_ARTEFACTS=/tmp/en16931 npx vitest run shared/ingestion/en16931-conformance.test.ts
 *
 * Two parts:
 * - every per-rule UBL test for a rule we check: the rule fails exactly
 *   where the official test says `<error>` and not where it says
 *   `<success>`;
 * - every official example invoice, UBL and CII, reads and passes all
 *   our rules — a valid invoice that we reported as failing would be a
 *   bug in us, not in the supplier.
 */

/**
 * Node's file system, reached without Node's types: `shared` is a Workers
 * package (see vite-env.d.ts), and this is the one test that reads files
 * named at run time rather than through `?raw`. The specifier is built so
 * `tsc` does not look for `node:fs`; vitest runs under Node and has it.
 */
interface Dirent {
  name: string;
  isDirectory(): boolean;
}
interface NodeFs {
  existsSync(path: string): boolean;
  readdirSync(path: string): string[];
  readdirSync(path: string, options: { withFileTypes: true }): Dirent[];
  readFileSync(path: string, encoding: "utf8"): string;
}
const node = "node:";
const { existsSync, readdirSync, readFileSync } = (await import(/* @vite-ignore */ `${node}fs`)) as NodeFs;
const join = (...parts: string[]) => parts.join("/").replace(/\/+/g, "/");
const env = (globalThis as unknown as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};

const ROOT = env.EN16931_ARTEFACTS;
const available = ROOT !== undefined && existsSync(join(ROOT, "test", "Invoice-unit-UBL"));

interface Case {
  file: string;
  index: number;
  expect: "success" | "error";
  rule: string;
  xml: string;
}

function casesIn(file: string, text: string): Case[] {
  const out: Case[] = [];
  const tests = text.split(/<test[\s>]/).slice(1);
  tests.forEach((block, index) => {
    const verdict = /<(success|error)>\s*([^<\s]+)\s*<\/\1>/.exec(block);
    const doc = /<Invoice[\s>][\s\S]*<\/Invoice>/.exec(block);
    if (!verdict || !doc) return;
    out.push({ file, index, expect: verdict[1] as "success" | "error", rule: verdict[2], xml: doc[0] });
  });
  return out;
}

/**
 * Cases whose official verdict depends on something a fragment cannot
 * show us, each with the reason. Kept short and explained, so a case
 * that starts failing is investigated rather than added here.
 */
const KNOWN_DIFFERENCES: Record<string, string> = {};

/** Rules with no official unit test; covered by our own tests instead. */
const NO_OFFICIAL_TEST = new Set(["BR-CO-9", "BR-CO-25"]);

describe.skipIf(!available)("EN 16931 official unit tests (UBL)", () => {
  const dir = join(ROOT ?? "", "test", "Invoice-unit-UBL");
  const ours = new Set<string>(EN16931_RULES.filter((r) => r !== "BR-DE-15"));
  const cases: Case[] = available
    ? readdirSync(dir)
        .filter((f: string) => f.endsWith(".xml"))
        .flatMap((f: string) => casesIn(f, readFileSync(join(dir, f), "utf8")))
        .filter((c: Case) => ours.has(c.rule))
    : [];

  it("finds a test for every rule we check", () => {
    const covered = new Set(cases.map((c) => c.rule));
    expect([...ours].filter((r) => !covered.has(r) && !NO_OFFICIAL_TEST.has(r))).toEqual([]);
  });

  it.each(cases.map((c) => [`${c.file} #${c.index + 1}: ${c.expect} ${c.rule}`, c] as const))("%s", (_name, c) => {
    const key = `${c.file}#${c.index + 1}`;
    if (KNOWN_DIFFERENCES[key]) return;
    let read;
    try {
      read = readInvoiceXml(c.xml);
    } catch (err) {
      /**
       * An `<Invoice>` with nothing in it is refused outright rather than
       * read as an invoice failing every rule — a stronger answer than the
       * official one, and only ever where the official test expects an
       * error.
       */
      expect(c.expect).toBe("error");
      expect(String((err as Error).message)).toMatch(/no root <Invoice>/);
      return;
    }
    const failed = (read.en16931?.failed ?? []).map((f) => f.rule as string);
    if (c.expect === "error") expect(failed).toContain(c.rule);
    else expect(failed).not.toContain(c.rule);
  });
});

describe.skipIf(!available)("EN 16931 official example invoices", () => {
  const examples = available
    ? [
        ...readdirSync(join(ROOT ?? "", "ubl", "examples")).map((f: string) => join(ROOT ?? "", "ubl", "examples", f)),
        ...readdirSync(join(ROOT ?? "", "cii", "examples")).map((f: string) => join(ROOT ?? "", "cii", "examples", f)),
      ].filter((f: string) => /\.xml$/i.test(f))
    : [];

  it.each(examples.map((f) => [f.slice((ROOT ?? "").length + 1), f] as const))("%s", (_name, file) => {
    const xml = readFileSync(file, "utf8");
    let read;
    try {
      read = readInvoiceXml(xml);
    } catch (err) {
      // A credit note is refused by design, not by accident.
      expect(String((err as Error).message)).toMatch(/credit note/);
      return;
    }
    expect(read.en16931?.failed ?? []).toEqual([]);
  });
});

/**
 * **KoSIT's XRechnung test suite** (github.com/itplr-kosit/xrechnung-testsuite,
 * Apache 2.0), read from a local clone named by `XRECHNUNG_TESTSUITE` for the
 * same reason: every valid XRechnung there, UBL and CII, must read and pass
 * every rule we check, BR-DE-15 included.
 */
const XR = env.XRECHNUNG_TESTSUITE;
const xrAvailable = XR !== undefined && existsSync(join(XR, "src", "test"));

/** Instances whose own figures break a rule; we are right to say so. */
const XR_KNOWN: Record<string, string> = {
  "business-cases/extension/05.01a-INVOICE_ubl.xml":
    "BR-CO-16: its amount due (366.86) is not its total with VAT (336.90) and it gives no paid or rounding amount",
};

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e: Dirent): string[] =>
    e.isDirectory() ? walk(join(dir, e.name)) : e.name.endsWith(".xml") ? [join(dir, e.name)] : []
  );
}

describe.skipIf(!xrAvailable)("XRechnung test suite", () => {
  const base = join(XR ?? "", "src", "test");
  const files = xrAvailable ? walk(base) : [];

  it.each(files.map((f) => [f.slice(base.length + 1), f] as const))("%s", (name, file) => {
    const read = readInvoiceXml(readFileSync(file, "utf8"));
    expect(read.format).toBe("xrechnung");
    const failed = (read.en16931?.failed ?? []).map((f) => f.rule as string);
    if (XR_KNOWN[name]) expect(failed).toEqual([XR_KNOWN[name].split(":")[0]]);
    else expect(failed).toEqual([]);
  });
});
