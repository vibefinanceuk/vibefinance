import type { CompilerModel } from "@vibefinance/shared";
import type { EmailLocale } from "./agent-email.js";

/**
 * **Chasing a supplier — decision 0632 (Agents phase 3, slice 2).**
 *
 * An invoice returned to its supplier (decision 0498) with no corrected
 * invoice after some days: an agent prepares an email asking for one, in
 * the supplier's language (German for DE, AT and CH, English otherwise),
 * in the AP team's name, to the address on file. The facts in it (the
 * invoice number, dates, total, days, the return's reason) come from
 * VibeFinance, never from the AI: the AI may only word the letter around
 * placeholders, and an edited letter is sent only if every number in it
 * is the invoice's own.
 */

export interface ChaseFacts {
  locale: EmailLocale;
  supplier: string;
  invoice: string;
  issued: string | null;
  returned: string;
  total: number | null;
  currency: string | null;
  reason: string | null;
  comment: string | null;
  company: string;
  days: number;
}

export function chaseLocale(country: unknown): EmailLocale {
  return typeof country === "string" &&
    ["DE", "AT", "CH"].includes(country.toUpperCase())
    ? "de"
    : "en";
}

function date(iso: string | null, locale: EmailLocale): string {
  if (!iso) return "—";
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return locale === "de"
    ? d.toLocaleDateString("de-DE", {
        timeZone: "UTC",
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
      })
    : d.toLocaleDateString("en-GB", {
        timeZone: "UTC",
        day: "numeric",
        month: "long",
        year: "numeric",
      });
}

function money(n: number | null, locale: EmailLocale): string {
  if (n === null) return "—";
  return n.toLocaleString(locale === "de" ? "de-DE" : "en-GB", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/** Each placeholder's words, as the supplier will read them. */
export function chaseValues(f: ChaseFacts): Record<string, string> {
  return {
    supplier: f.supplier,
    invoice: f.invoice,
    issued: date(f.issued, f.locale),
    returned: date(f.returned, f.locale),
    total: money(f.total, f.locale),
    currency: f.currency ?? "",
    reason: f.reason ?? "",
    company: f.company,
    days: String(f.days),
  };
}

const WORDS: Record<
  EmailLocale,
  { subject: string; body: string; comment: string }
> = {
  en: {
    subject: "Invoice {invoice}: returned on {returned}",
    body: `Dear {supplier},

On {returned} we returned your invoice {invoice} dated {issued} for {total} {currency}, because: {reason}.

We have not yet received a corrected invoice. Please send one, or let us know if it is already on its way.

Kind regards,
{company}, Accounts Payable`,
    comment: "Our note at the time: {comment}",
  },
  de: {
    subject: "Rechnung {invoice}: zurückgesandt am {returned}",
    body: `Sehr geehrte Damen und Herren,

am {returned} haben wir Ihre Rechnung {invoice} vom {issued} über {total} {currency} zurückgesandt. Grund: {reason}.

Eine korrigierte Rechnung liegt uns noch nicht vor. Bitte senden Sie uns diese zu oder teilen Sie uns mit, ob sie bereits unterwegs ist.

Mit freundlichen Grüßen
{company}, Kreditorenbuchhaltung`,
    comment: "Unser Hinweis damals: {comment}",
  },
};

function fill(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (m, k: string) =>
    k in values ? values[k] : m,
  );
}

/** The subject, and the letter written from our own words. */
export function chaseTemplate(f: ChaseFacts): {
  subject: string;
  body: string;
} {
  const v = chaseValues(f);
  const words = WORDS[f.locale];
  const body = fill(words.body, v);
  const withComment = f.comment
    ? body.replace(
        /\n\n(?=[^\n]*\n[^\n]*$)/,
        `\n\n${fill(words.comment, { comment: f.comment })}\n\n`,
      )
    : body;
  return { subject: fill(words.subject, v), body: withComment };
}

const PLACEHOLDERS = [
  "supplier",
  "invoice",
  "issued",
  "returned",
  "total",
  "currency",
  "reason",
  "company",
];

/**
 * The AI's wording, or null when it could not be used. It is told to
 * write only around placeholders; what comes back must name the invoice
 * and the return, use no placeholder we do not have, and carry no digit,
 * address or link of its own, or our own letter is used instead.
 */
export async function chaseWording(
  model: CompilerModel,
  f: ChaseFacts,
): Promise<string | null> {
  const language = f.locale === "de" ? "German" : "English";
  const prompt = `Write a short, polite email from an accounts payable team to a supplier, in ${language}.
The supplier's invoice was returned to them because of a problem, and no corrected invoice has arrived since. Ask them for a corrected invoice, or to say if it is on its way.

Write the facts ONLY as these placeholders, exactly as written, and never as numbers or dates of your own:
{supplier} the supplier's name; {invoice} the invoice number; {issued} the invoice date; {returned} the date it was returned; {total} the amount; {currency} the currency; {reason} why it was returned; {company} our company.
You must use {invoice} and {returned}. Do not write any digits, email addresses or links. No subject line. Sign off as "{company}, ${f.locale === "de" ? "Kreditorenbuchhaltung" : "Accounts Payable"}".
Return only the email body.`;
  let said: string;
  try {
    said = await model.compile(prompt);
  } catch {
    return null;
  }
  const text = said
    .replace(/<think>[\s\S]*?<\/think>/g, "")
    .replace(/^\s*(subject|betreff)\s*:.*$/gim, "")
    .replace(/[*#_`]/g, "")
    .trim();
  if (!text || text.length > 1500) return null;
  if (/\d|@|https?:/i.test(text)) return null;
  if (!text.includes("{invoice}") || !text.includes("{returned}")) return null;
  const used = [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
  if (used.some((k) => !PLACEHOLDERS.includes(k))) return null;
  return fill(text, chaseValues(f));
}

/**
 * **The check on a letter about to be sent.** The words that are facts
 * (the invoice number, the dates, total, days, names and reasons) are set
 * aside; any digit left over is a number that is not the invoice's own,
 * and the first is returned. Null when there is none.
 */
export function strayInChase(text: string, f: ChaseFacts): string | null {
  const v = chaseValues(f);
  const allowed = [
    v.invoice,
    v.issued,
    v.returned,
    v.total,
    v.days,
    f.supplier,
    f.company,
    f.reason ?? "",
    f.comment ?? "",
    f.currency ?? "",
  ]
    .filter((x) => x && x !== "—")
    .sort((a, b) => b.length - a.length);
  let rest = text;
  for (const a of allowed) rest = rest.split(a).join(" ");
  const m = rest.match(/\d[\d.,]*/);
  return m ? m[0] : null;
}
