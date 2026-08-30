/**
 * Locale-aware messages for vf-app's genuinely customer-facing API
 * responses. See docs/decisions/0008-locale-aware-messages.md for the
 * scope this deliberately does and does not cover — most strings in
 * this codebase are operator/deployment-facing (reference internal
 * env var names like "LICENCE_SIGNING_PUBLIC_KEY") and are
 * deliberately left in English, not translated here.
 *
 * A per-deployment setting, not per-request: Env.LOCALE in
 * wrangler.jsonc, following the exact same "one Worker per customer,
 * configured via vars" pattern already used for CUSTOMER_ID and
 * LICENCE_SIGNING_PUBLIC_KEY — a customer's whole integration operates
 * in one language, not a different one per request.
 */

export const SUPPORTED_LOCALES = ["en", "de", "fr", "es", "it", "nl"] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];

export type MessageKey =
  | "invalidJsonBody"
  | "factsInvoiceIdRequired"
  | "exactlyOneRuleSetRequired"
  | "ruleSetDoesNotExist"
  | "ruleRejectedByVocabulary"
  | "processingBlocked"
  | "noLicenceProvisioned"
  | "licenceBlockedFallback"
  | "ruleSetIdSourceTextRequired"
  | "confirmedByRequired"
  | "exampleDoesNotExist"
  | "activatedByRequired"
  | "ruleVersionDoesNotExist"
  | "alreadyActivated"
  | "cannotActivateNoExamples"
  | "cannotActivateUnconfirmed"
  | "unauthorized"
  | "forbidden";

type MessageParams = Record<string, string | number>;

// API field names (ruleSet, ruleSetId, facts, invoiceId, confirmedBy,
// activatedBy) are deliberately left untranslated in every language —
// they're literal JSON keys a client's integration code checks
// against, not prose, the same convention most localized APIs follow.
const MESSAGES: Record<MessageKey, Record<Locale, string>> = {
  invalidJsonBody: {
    en: "invalid JSON body",
    de: "Ungültiger JSON-Text",
    fr: "Corps JSON invalide",
    es: "Cuerpo JSON no válido",
    it: "Corpo JSON non valido",
    nl: "Ongeldige JSON-inhoud",
  },
  factsInvoiceIdRequired: {
    en: "facts and invoiceId are required",
    de: "facts und invoiceId sind erforderlich",
    fr: "facts et invoiceId sont requis",
    es: "Se requieren facts e invoiceId",
    it: "facts e invoiceId sono obbligatori",
    nl: "facts en invoiceId zijn verplicht",
  },
  exactlyOneRuleSetRequired: {
    en: "exactly one of ruleSet or ruleSetId is required",
    de: "Es ist entweder ruleSet oder ruleSetId erforderlich, aber nicht beides",
    fr: "Un seul des deux, ruleSet ou ruleSetId, est requis",
    es: "Se requiere exactamente uno de ruleSet o ruleSetId",
    it: "È richiesto esattamente uno tra ruleSet e ruleSetId",
    nl: "Precies één van ruleSet of ruleSetId is verplicht",
  },
  ruleSetDoesNotExist: {
    en: "rule set {ruleSetId} does not exist",
    de: "Regelwerk {ruleSetId} existiert nicht",
    fr: "Le jeu de règles {ruleSetId} n'existe pas",
    es: "El conjunto de reglas {ruleSetId} no existe",
    it: "Il set di regole {ruleSetId} non esiste",
    nl: "Regelset {ruleSetId} bestaat niet",
  },
  ruleRejectedByVocabulary: {
    en: "rule {ruleId} rejected by the closed vocabulary",
    de: "Regel {ruleId} wurde vom geschlossenen Vokabular abgelehnt",
    fr: "La règle {ruleId} a été rejetée par le vocabulaire fermé",
    es: "La regla {ruleId} fue rechazada por el vocabulario cerrado",
    it: "La regola {ruleId} è stata rifiutata dal vocabolario chiuso",
    nl: "Regel {ruleId} is afgewezen door de gesloten woordenlijst",
  },
  processingBlocked: {
    en: "processing blocked",
    de: "Verarbeitung blockiert",
    fr: "Traitement bloqué",
    es: "Procesamiento bloqueado",
    it: "Elaborazione bloccata",
    nl: "Verwerking geblokkeerd",
  },
  noLicenceProvisioned: {
    en: "no licence has been provisioned for this instance yet",
    de: "Für diese Instanz wurde noch keine Lizenz bereitgestellt",
    fr: "Aucune licence n'a encore été attribuée à cette instance",
    es: "Todavía no se ha aprovisionado ninguna licencia para esta instancia",
    it: "Non è ancora stata assegnata alcuna licenza a questa istanza",
    nl: "Voor deze instantie is nog geen licentie toegewezen",
  },
  licenceBlockedFallback: {
    en: "licence blocked",
    de: "Lizenz gesperrt",
    fr: "Licence bloquée",
    es: "Licencia bloqueada",
    it: "Licenza bloccata",
    nl: "Licentie geblokkeerd",
  },
  ruleSetIdSourceTextRequired: {
    en: "ruleSetId and sourceText (both strings) are required",
    de: "ruleSetId und sourceText (beides Zeichenketten) sind erforderlich",
    fr: "ruleSetId et sourceText (les deux sous forme de chaînes) sont requis",
    es: "Se requieren ruleSetId y sourceText (ambos como cadenas de texto)",
    it: "ruleSetId e sourceText (entrambi come stringhe) sono obbligatori",
    nl: "ruleSetId en sourceText (beide als tekenreeksen) zijn verplicht",
  },
  confirmedByRequired: {
    en: "confirmedBy (string) is required",
    de: "confirmedBy (Zeichenkette) ist erforderlich",
    fr: "confirmedBy (chaîne de caractères) est requis",
    es: "Se requiere confirmedBy (cadena de texto)",
    it: "confirmedBy (stringa) è obbligatorio",
    nl: "confirmedBy (tekenreeks) is verplicht",
  },
  exampleDoesNotExist: {
    en: "example {exampleId} does not exist",
    de: "Beispiel {exampleId} existiert nicht",
    fr: "L'exemple {exampleId} n'existe pas",
    es: "El ejemplo {exampleId} no existe",
    it: "L'esempio {exampleId} non esiste",
    nl: "Voorbeeld {exampleId} bestaat niet",
  },
  activatedByRequired: {
    en: "activatedBy (string) is required",
    de: "activatedBy (Zeichenkette) ist erforderlich",
    fr: "activatedBy (chaîne de caractères) est requis",
    es: "Se requiere activatedBy (cadena de texto)",
    it: "activatedBy (stringa) è obbligatorio",
    nl: "activatedBy (tekenreeks) is verplicht",
  },
  ruleVersionDoesNotExist: {
    en: "rule {ruleId} version {version} does not exist",
    de: "Regel {ruleId}, Version {version}, existiert nicht",
    fr: "La règle {ruleId}, version {version}, n'existe pas",
    es: "La regla {ruleId}, versión {version}, no existe",
    it: "La regola {ruleId}, versione {version}, non esiste",
    nl: "Regel {ruleId}, versie {version}, bestaat niet",
  },
  alreadyActivated: {
    en: "already activated",
    de: "Bereits aktiviert",
    fr: "Déjà activée",
    es: "Ya activada",
    it: "Già attivata",
    nl: "Al geactiveerd",
  },
  cannotActivateNoExamples: {
    en: "cannot activate: no worked examples exist for this rule version",
    de: "Aktivierung nicht möglich: Für diese Regelversion liegen keine Beispiele vor",
    fr: "Activation impossible : aucun exemple n'existe pour cette version de la règle",
    es: "No se puede activar: no existen ejemplos para esta versión de la regla",
    it: "Impossibile attivare: non esistono esempi per questa versione della regola",
    nl: "Activeren niet mogelijk: er bestaan geen voorbeelden voor deze regelversie",
  },
  cannotActivateUnconfirmed: {
    en: "cannot activate: {unconfirmed} of {total} example(s) not yet confirmed",
    de: "Aktivierung nicht möglich: {unconfirmed} von {total} Beispiel(en) noch nicht bestätigt",
    fr: "Activation impossible : {unconfirmed} exemple(s) sur {total} non encore confirmé(s)",
    es: "No se puede activar: {unconfirmed} de {total} ejemplo(s) aún sin confirmar",
    it: "Impossibile attivare: {unconfirmed} esempio/i su {total} non ancora confermato/i",
    nl: "Activeren niet mogelijk: {unconfirmed} van {total} voorbeeld(en) nog niet bevestigd",
  },
  unauthorized: {
    en: "unauthorized",
    de: "Nicht autorisiert",
    fr: "Non autorisé",
    es: "No autorizado",
    it: "Non autorizzato",
    nl: "Niet geautoriseerd",
  },
  forbidden: {
    en: "you do not have permission to do this",
    de: "Sie sind nicht berechtigt, diese Aktion auszuführen",
    fr: "Vous n'êtes pas autorisé à effectuer cette action",
    es: "No tiene permiso para realizar esta acción",
    it: "Non si dispone dell'autorizzazione per eseguire questa azione",
    nl: "U heeft geen toestemming om deze actie uit te voeren",
  },
};

/** Falls back to "en" for anything unset or unrecognised — never
 * throws on a bad or missing value, since this reads a deployment var
 * that could be anything before an operator sets it correctly. */
export function resolveLocale(raw: unknown): Locale {
  if (typeof raw === "string" && (SUPPORTED_LOCALES as readonly string[]).includes(raw)) {
    return raw as Locale;
  }
  return "en";
}

/**
 * Renders a message key in the given locale, substituting any
 * `{param}` placeholders. Falls back to the English template if a
 * locale is somehow missing from MESSAGES for a given key — belt and
 * braces on top of resolveLocale already only ever returning a
 * SUPPORTED_LOCALES member, since a message catalog is exactly the
 * kind of thing a future edit could accidentally leave incomplete for
 * one language.
 */
export function t(key: MessageKey, locale: Locale, params?: MessageParams): string {
  const localeMessages = MESSAGES[key];
  const template = localeMessages[locale] ?? localeMessages.en;
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = params[name];
    return value === undefined ? match : String(value);
  });
}
