/**
 * The functions a mapping line can apply to a value — decision 0561.
 *
 * **A closed vocabulary, like the rule language's.** A person says what
 * should happen to a value in their own words ("read it as
 * day.month.year"); the compiler turns that into a chain of these, and
 * nothing else. So what a mapping can do has a fixed answer, stated here:
 * no loops, no arithmetic beyond the few listed, no calls out. A chain is
 * at most `MAX_CHAIN` steps.
 *
 * **Pure.** The same chain and the same value give the same result, so a
 * mapping reproduces from two inputs — the mapping and the document —
 * the property the rule interpreter already has.
 *
 * **Failure is an answer, not an exception.** A value a function cannot
 * handle (a date that does not fit its pattern) gives `{ ok: false,
 * reason }` in words, and the message fails at translation with that
 * reason, where the Route monitor shows it and Reprocess runs it again
 * once the mapping is fixed.
 */

export const MAX_CHAIN = 5;

export type FnValue = string | number | null;
export type FnResult = { ok: true; value: FnValue } | { ok: false; reason: string };

export interface FunctionStep {
  fn: FunctionName;
  args?: Record<string, string | number>;
}

/**
 * **The customer's own look-up lists — decision 0568.** Read by
 * `look_up`, and loaded by the caller for the lists a mapping names: the
 * functions stay pure, and never reach a database themselves. Keys are the
 * values as a supplier writes them, trimmed and in lower case.
 */
export interface LookupList {
  name: string;
  entries: Record<string, string>;
}
export interface FnContext {
  lookups?: Record<string, LookupList>;
}

/** A value as a look-up list keys it: trimmed, in lower case. */
export const lookupKey = (v: string) => v.trim().toLowerCase();

interface FunctionDef {
  /** What it does, for the compiler's prompt and for people. */
  describe: string;
  /** Its arguments: name → what it is. Every one is required. */
  args: Record<string, "text" | "number">;
  apply(value: FnValue, args: Record<string, string | number>, ctx?: FnContext): FnResult;
}

const text = (v: FnValue) => (v === null ? "" : String(v));
const ok = (value: FnValue): FnResult => ({ ok: true, value });
const fail = (reason: string): FnResult => ({ ok: false, reason });

/**
 * Date patterns: `dd`, `d`, `MM`, `M`, `yyyy`, `yy`, and any separator
 * between them, as written on the invoice. `yy` is read as 20yy.
 */
function datePattern(pattern: string): { regex: RegExp; order: string[] } | null {
  const tokens = pattern.match(/yyyy|yy|MM|M|dd|d|[^yMd]+/g);
  if (!tokens || tokens.join("") !== pattern) return null;
  const order: string[] = [];
  let source = "^";
  const groups: Record<string, [string, string]> = {
    yyyy: ["y4", "(\\d{4})"],
    yy: ["y2", "(\\d{2})"],
    MM: ["m", "(\\d{2})"],
    M: ["m", "(\\d{1,2})"],
    dd: ["d", "(\\d{2})"],
    d: ["d", "(\\d{1,2})"],
  };
  for (const t of tokens) {
    const group = groups[t];
    if (group) {
      order.push(group[0]);
      source += group[1];
    } else {
      source += t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }
  }
  if (!order.includes("d") || !order.includes("m") || !(order.includes("y4") || order.includes("y2"))) return null;
  return { regex: new RegExp(`${source}$`), order };
}

function isoDate(y: number, m: number, d: number): string | null {
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/**
 * Countries: the EU and EEA, the UK, Switzerland, and the largest
 * trading partners outside them — not the whole of ISO 3166. A name or
 * code outside the list is refused in words rather than guessed, and the
 * list grows by adding a row here.
 */
export const COUNTRIES: ReadonlyArray<[code: string, en: string, de: string]> = [
  ["AT", "Austria", "Österreich"], ["BE", "Belgium", "Belgien"], ["BG", "Bulgaria", "Bulgarien"],
  ["HR", "Croatia", "Kroatien"], ["CY", "Cyprus", "Zypern"], ["CZ", "Czechia", "Tschechien"],
  ["DK", "Denmark", "Dänemark"], ["EE", "Estonia", "Estland"], ["FI", "Finland", "Finnland"],
  ["FR", "France", "Frankreich"], ["DE", "Germany", "Deutschland"], ["GR", "Greece", "Griechenland"],
  ["HU", "Hungary", "Ungarn"], ["IE", "Ireland", "Irland"], ["IT", "Italy", "Italien"],
  ["LV", "Latvia", "Lettland"], ["LT", "Lithuania", "Litauen"], ["LU", "Luxembourg", "Luxemburg"],
  ["MT", "Malta", "Malta"], ["NL", "Netherlands", "Niederlande"], ["PL", "Poland", "Polen"],
  ["PT", "Portugal", "Portugal"], ["RO", "Romania", "Rumänien"], ["SK", "Slovakia", "Slowakei"],
  ["SI", "Slovenia", "Slowenien"], ["ES", "Spain", "Spanien"], ["SE", "Sweden", "Schweden"],
  ["IS", "Iceland", "Island"], ["LI", "Liechtenstein", "Liechtenstein"], ["NO", "Norway", "Norwegen"],
  ["CH", "Switzerland", "Schweiz"], ["GB", "United Kingdom", "Vereinigtes Königreich"],
  ["US", "United States", "Vereinigte Staaten"], ["CA", "Canada", "Kanada"], ["CN", "China", "China"],
  ["JP", "Japan", "Japan"], ["IN", "India", "Indien"], ["AU", "Australia", "Australien"],
  ["TR", "Türkiye", "Türkei"], ["KR", "South Korea", "Südkorea"],
];
const COUNTRY_ALIASES: Record<string, string> = {
  uk: "GB", "great britain": "GB", england: "GB", scotland: "GB", wales: "GB", usa: "US",
  "united states of america": "US", holland: "NL", "czech republic": "CZ", turkey: "TR",
  schweiz: "CH", suisse: "CH", "brd": "DE", "bundesrepublik deutschland": "DE",
};

/**
 * Units of measure: common ways an invoice names a unit, to the UN/ECE
 * Recommendation 20 codes EN 16931 uses (BT-130). Case does not matter.
 */
export const UNITS: Record<string, string> = {
  stk: "H87", "stk.": "H87", st: "H87", "st.": "H87", "stück": "H87", pcs: "H87", pc: "H87", piece: "H87",
  pieces: "H87", ea: "H87", each: "H87", x: "H87",
  kg: "KGM", kilo: "KGM", g: "GRM", t: "TNE", tonne: "TNE",
  m: "MTR", meter: "MTR", metre: "MTR", km: "KMT", m2: "MTK", "m²": "MTK", qm: "MTK", m3: "MTQ", "m³": "MTQ", cbm: "MTQ",
  l: "LTR", ltr: "LTR", liter: "LTR", litre: "LTR",
  h: "HUR", hr: "HUR", hrs: "HUR", std: "HUR", "std.": "HUR", stunde: "HUR", stunden: "HUR", hour: "HUR", hours: "HUR",
  tag: "DAY", tage: "DAY", day: "DAY", days: "DAY", monat: "MON", month: "MON", months: "MON",
  set: "SET", satz: "SET", paar: "PR", pair: "PR", pal: "PF", palette: "PF", pallet: "PF",
  kwh: "KWH", pauschal: "LS", "lump sum": "LS",
};

const toNumber = (raw: string): number | null => {
  const n = Number(raw);
  return raw.trim() !== "" && Number.isFinite(n) ? n : null;
};

export const FUNCTIONS = {
  read_date: {
    describe: "read a date written in a pattern such as dd.MM.yyyy, d/M/yy or yyyyMMdd, giving an ISO date",
    args: { pattern: "text" },
    apply(value, args) {
      const pattern = datePattern(String(args.pattern));
      if (!pattern) return fail(`"${args.pattern}" is not a date pattern`);
      const m = pattern.regex.exec(text(value).trim());
      if (!m) return fail(`"${text(value)}" is not a date written ${args.pattern}`);
      const parts: Record<string, number> = {};
      pattern.order.forEach((k, i) => (parts[k] = Number(m[i + 1])));
      const year = parts.y4 ?? 2000 + parts.y2;
      const iso = isoDate(year, parts.m, parts.d);
      return iso ? ok(iso) : fail(`"${text(value)}" is not a real date`);
    },
  },
  write_date: {
    describe: "write an ISO date (2026-09-29) in another pattern, such as MM/dd/yyyy",
    args: { pattern: "text" },
    apply(value, args) {
      const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text(value).trim());
      if (!m) return fail(`"${text(value)}" is not an ISO date`);
      if (!datePattern(String(args.pattern))) return fail(`"${args.pattern}" is not a date pattern`);
      const out = String(args.pattern)
        .replace(/yyyy/g, m[1])
        .replace(/yy/g, m[1].slice(2))
        .replace(/MM/g, m[2])
        .replace(/(?<!M)M(?!M)/g, String(Number(m[2])))
        .replace(/dd/g, m[3])
        .replace(/(?<!d)d(?!d)/g, String(Number(m[3])));
      return ok(out);
    },
  },
  decimal_comma: {
    describe: "read an amount written with a decimal comma and dots or spaces between thousands, such as 1.234,56",
    args: {},
    apply(value) {
      const raw = text(value).trim().replace(/[\s\u00a0']/g, "");
      if (!/^-?[\d.]*,?\d+$/.test(raw)) return fail(`"${text(value)}" is not an amount with a decimal comma`);
      const n = toNumber(raw.replace(/\./g, "").replace(",", "."));
      return n === null ? fail(`"${text(value)}" is not an amount`) : ok(n);
    },
  },
  number: {
    describe: "read an amount written with a decimal point and commas between thousands, such as 1,234.56",
    args: {},
    apply(value) {
      if (typeof value === "number") return ok(value);
      const raw = text(value).trim().replace(/[\s\u00a0,']/g, "");
      const n = toNumber(raw);
      return n === null ? fail(`"${text(value)}" is not an amount`) : ok(n);
    },
  },
  round: {
    describe: "round a number to a number of decimal places",
    args: { places: "number" },
    apply(value, args) {
      const n = typeof value === "number" ? value : toNumber(text(value));
      if (n === null) return fail(`"${text(value)}" is not a number`);
      const f = 10 ** Number(args.places);
      return ok(Math.round(n * f) / f);
    },
  },
  multiply: {
    describe: "multiply a number by a fixed number, for example -1 to change its sign or 0.01 to turn cents into units",
    args: { by: "number" },
    apply(value, args) {
      const n = typeof value === "number" ? value : toNumber(text(value));
      if (n === null) return fail(`"${text(value)}" is not a number`);
      return ok(Math.round(n * Number(args.by) * 1e6) / 1e6);
    },
  },
  trim: { describe: "remove spaces at either end", args: {}, apply: (v) => ok(text(v).trim()) },
  upper: { describe: "write in capital letters", args: {}, apply: (v) => ok(text(v).toUpperCase()) },
  lower: { describe: "write in small letters", args: {}, apply: (v) => ok(text(v).toLowerCase()) },
  first_letters: {
    describe: "keep only the first n characters",
    args: { n: "number" },
    apply: (v, a) => ok(text(v).slice(0, Number(a.n))),
  },
  last_letters: {
    describe: "keep only the last n characters",
    args: { n: "number" },
    apply: (v, a) => ok(Number(a.n) <= 0 ? "" : text(v).slice(-Number(a.n))),
  },
  remove_prefix: {
    describe: "remove a prefix, such as PO-, where the value starts with it",
    args: { prefix: "text" },
    apply: (v, a) => {
      const s = text(v);
      return ok(s.startsWith(String(a.prefix)) ? s.slice(String(a.prefix).length) : s);
    },
  },
  replace: {
    describe: "replace every occurrence of some text with other text (which may be empty)",
    args: { find: "text", with: "text" },
    apply: (v, a) => ok(text(v).split(String(a.find)).join(String(a.with))),
  },
  remove_spaces: { describe: "remove every space, as in an IBAN", args: {}, apply: (v) => ok(text(v).replace(/\s+/g, "")) },
  country_to_code: {
    describe: "turn a country's name, in English or German, into its two-letter code (Deutschland to DE)",
    args: {},
    apply(value) {
      const s = text(value).trim();
      if (/^[A-Za-z]{2}$/.test(s) && COUNTRIES.some(([c]) => c === s.toUpperCase())) return ok(s.toUpperCase());
      const lower = s.toLowerCase();
      const hit = COUNTRIES.find(([, en, de]) => en.toLowerCase() === lower || de.toLowerCase() === lower);
      if (hit) return ok(hit[0]);
      if (COUNTRY_ALIASES[lower]) return ok(COUNTRY_ALIASES[lower]);
      return fail(`"${s}" is not a country this function knows`);
    },
  },
  add_days: {
    describe: "add a number of days to an ISO date (2026-09-29), giving an ISO date; a negative number goes back",
    args: { days: "number" },
    apply(value, args) {
      const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text(value).trim());
      if (!m) return fail(`"${text(value)}" is not an ISO date`);
      const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + Number(args.days)));
      return ok(isoDate(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()));
    },
  },
  code_to_country: {
    describe: "turn a two-letter country code into the country's name, in English (en) or German (de)",
    args: { language: "text" },
    apply(value, args) {
      const hit = COUNTRIES.find(([c]) => c === text(value).trim().toUpperCase());
      if (!hit) return fail(`"${text(value)}" is not a country code this function knows`);
      return ok(String(args.language) === "de" ? hit[2] : hit[1]);
    },
  },
  unit_code: {
    describe: "turn a unit as an invoice writes it (Stk, kg, Std.) into its UN/ECE code (H87, KGM, HUR)",
    args: {},
    apply(value) {
      const s = text(value).trim();
      if (/^[A-Z0-9]{2,3}$/.test(s) && Object.values(UNITS).includes(s)) return ok(s);
      const code = UNITS[s.toLowerCase()];
      if (code) return ok(code);
      /**
       * **A code already, as a look-up list gives it — decision 0568.** A
       * word it does not know, written as a code is (two or three capital
       * letters or digits, such as RO from a Units list), is taken as the
       * code. Words it knows come first, so "ST" is still a piece (H87).
       */
      if (/^[A-Z0-9]{2,3}$/.test(s) && /[A-Z]/.test(s)) return ok(s);
      return fail(`"${s}" is not a unit this function knows`);
    },
  },
  look_up: {
    describe:
      "look the value up in one of the customer's own look-up lists (by the list's id) and give what the list says it becomes; otherwise is refuse (a value not in the list is a problem), keep (it is left as it is, for the next step) or unless_empty (as refuse, but a list with nothing in it gives an empty value: a list a customer does not use)",
    args: { list: "text", otherwise: "text" },
    apply(value, args, ctx) {
      const list = ctx?.lookups?.[String(args.list)];
      if (!list) return fail(`the look-up list "${args.list}" is not available: it may have been retired`);
      const s = text(value);
      const hit = list.entries[lookupKey(s)];
      if (hit !== undefined) return ok(hit);
      if (String(args.otherwise) === "keep") return ok(value);
      // Decision 0607: a list the customer leaves empty is one they do not use (an Intacct company without tax).
      if (String(args.otherwise) === "unless_empty" && Object.keys(list.entries).length === 0) return ok(null);
      return fail(`"${s}" is not in the list ${list.name}`);
    },
  },
  // Decision 0606: what SAP's OData services want, and any target like them.
  odata_date: {
    describe: "write an ISO date (2026-09-29) as OData's /Date(milliseconds)/, as SAP's OData services want it",
    args: {},
    apply(value) {
      const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text(value).trim());
      if (!m) return fail(`"${text(value)}" is not an ISO date`);
      return ok(`/Date(${Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))})/`);
    },
  },
  decimal_text: {
    describe: "write a number as text with a fixed number of decimal places (120 to \"120.00\"), as SAP wants amounts",
    args: { places: "number" },
    apply(value, args) {
      const n = typeof value === "number" ? value : toNumber(text(value));
      if (n === null) return fail(`"${text(value)}" is not a number`);
      return ok(n.toFixed(Number(args.places)));
    },
  },
  pad: {
    describe: "write a whole number as text with zeros in front, to a number of digits (7 to 0007)",
    args: { digits: "number" },
    apply(value, args) {
      const s = text(value).trim();
      if (!/^\d+$/.test(s)) return fail(`"${s}" is not a whole number`);
      return ok(s.padStart(Number(args.digits), "0"));
    },
  },
  if_empty: {
    describe: "use a fixed value where the value is missing or empty",
    args: { value: "text" },
    apply: (v, a) => ok(v === null || text(v).trim() === "" ? String(a.value) : v),
  },
  always: {
    describe: "always give a fixed value, whatever the document says — for a field the document never carries",
    args: { value: "text" },
    apply: (_v, a) => ok(String(a.value)),
  },
} satisfies Record<string, FunctionDef>;

export type FunctionName = keyof typeof FUNCTIONS;
export const FUNCTION_NAMES = Object.keys(FUNCTIONS) as FunctionName[];

/** Why a chain cannot be stored, or null where it can. */
export function validateChain(chain: unknown): string | null {
  if (!Array.isArray(chain)) return "a function chain is a list of steps";
  if (chain.length > MAX_CHAIN) return `a chain has at most ${MAX_CHAIN} steps`;
  for (const step of chain) {
    const s = step as FunctionStep;
    if (!s || typeof s !== "object" || !(FUNCTION_NAMES as string[]).includes(s.fn)) {
      return `"${String((s as { fn?: unknown })?.fn)}" is not a function`;
    }
    const def = FUNCTIONS[s.fn] as FunctionDef;
    const args = s.args ?? {};
    for (const [name, type] of Object.entries(def.args)) {
      const v = args[name];
      if (v === undefined) return `${s.fn} needs ${name}`;
      if (type === "number" && typeof v !== "number") return `${s.fn}'s ${name} is a number`;
      if (type === "text" && typeof v !== "string") return `${s.fn}'s ${name} is text`;
    }
    for (const name of Object.keys(args)) if (!(name in def.args)) return `${s.fn} takes no ${name}`;
    if ((s.fn === "read_date" || s.fn === "write_date") && !datePattern(String(args.pattern))) {
      return `"${args.pattern}" is not a date pattern`;
    }
    if (s.fn === "look_up" && args.otherwise !== "refuse" && args.otherwise !== "keep" && args.otherwise !== "unless_empty") {
      return "look_up's otherwise is refuse, keep or unless_empty";
    }
  }
  return null;
}

/** Runs a chain over a value, stopping at the first step that fails. */
export function applyChain(chain: readonly FunctionStep[], value: FnValue, ctx?: FnContext): FnResult {
  let current: FnValue = value;
  for (const step of chain) {
    const r = (FUNCTIONS[step.fn] as FunctionDef).apply(current, step.args ?? {}, ctx);
    if (!r.ok) return r;
    current = r.value;
  }
  return ok(current);
}

/** The vocabulary in words, for the compiler's prompt. One source. */
export function describeFunctions(): string {
  return FUNCTION_NAMES.map((name) => {
    const def = FUNCTIONS[name] as FunctionDef;
    const args = Object.entries(def.args)
      .map(([a, t]) => `${a}: ${t}`)
      .join(", ");
    return `- ${name}(${args}): ${def.describe}`;
  }).join("\n");
}

/** The look-up lists a chain names, by id: what a caller loads before running it (0568). */
export function listsInChain(chain: readonly FunctionStep[]): string[] {
  return chain.filter((s) => s.fn === "look_up").map((s) => String(s.args?.list ?? ""));
}
