/**
 * The standard's own code lists — decision 0113.
 *
 * **Not configuration.** Decision 0107 put the interface's *words* in
 * D1 so a wording fix needs no deployment, because those words are ours
 * to change. A code list is not: ISO 4217 is the standard, editing it
 * would make a document non-conformant, and a customer must never be
 * able to.
 *
 * The operator's line, which settles where these live:
 *
 *   If we are saying that the standard code lists are our baseline,
 *   then they should never need customer specific configuration.
 *
 * So they sit beside the vocabulary, in code, with the **agency and
 * version recorded** — because "which ISO 4217" is a real question when
 * a currency is added or withdrawn, and a list without a version cannot
 * answer it.
 *
 * Transcribed from `docs.peppol.eu/poacc/billing/3.0/codelist/`, which
 * publishes exactly what Peppol BIS Billing 3.0 accepts — not from a
 * general ISO source, because Peppol's own subset is the thing a
 * document is validated against.
 */

export interface CodeList {
  /** As the specification names it: `ISO4217`, `UNECERec20`. */
  id: string;
  /** Who maintains it — `ISO`, `UN/ECE`, `UN/CEFACT`. */
  agency: string;
  /** The version Peppol publishes, so a change is visible in a diff. */
  version: string;
  /** A human name for the list itself, for an interface to label with. */
  name: string;
  /** Code to name, in the specification's own order. */
  codes: [string, string][];
}

/**
 * ISO 4217 currency codes.
 *
 * Used by BT-5 (invoice currency), BT-6 (VAT accounting currency), and
 * the mandatory `@currencyID` on every amount.
 */
export const ISO_4217: CodeList = {
  id: "ISO4217",
  agency: "ISO",
  version: "2018-01-01",
  name: "Currency",
  codes: [
  ["AED", "UAE Dirham"],
  ["AFN", "Afghani"],
  ["ALL", "Lek"],
  ["AMD", "Armenian Dram"],
  ["AOA", "Kwanza"],
  ["ARS", "Argentine Peso"],
  ["AUD", "Australian Dollar"],
  ["AWG", "Aruban Florin"],
  ["AZN", "Azerbaijan Manat"],
  ["BAM", "Convertible Mark"],
  ["BBD", "Barbados Dollar"],
  ["BDT", "Taka"],
  ["BHD", "Bahraini Dinar"],
  ["BIF", "Burundi Franc"],
  ["BMD", "Bermudian Dollar"],
  ["BND", "Brunei Dollar"],
  ["BOB", "Boliviano"],
  ["BOV", "Mvdol"],
  ["BRL", "Brazilian Real"],
  ["BSD", "Bahamian Dollar"],
  ["BTN", "Ngultrum"],
  ["BWP", "Pula"],
  ["BYN", "Belarusian Ruble"],
  ["BZD", "Belize Dollar"],
  ["CAD", "Canadian Dollar"],
  ["CDF", "Congolese Franc"],
  ["CHE", "WIR Euro"],
  ["CHF", "Swiss Franc"],
  ["CHW", "WIR Franc"],
  ["CLF", "Unidad de Fomento"],
  ["CLP", "Chilean Peso"],
  ["CNH", "Renminbi (offshore)"],
  ["CNY", "Yuan Renminbi"],
  ["COP", "Colombian Peso"],
  ["COU", "Unidad de Valor Real"],
  ["CRC", "Costa Rican Colon"],
  ["CUP", "Cuban Peso"],
  ["CVE", "Cabo Verde Escudo"],
  ["CZK", "Czech Koruna"],
  ["DJF", "Djibouti Franc"],
  ["DKK", "Danish Krone"],
  ["DOP", "Dominican Peso"],
  ["DZD", "Algerian Dinar"],
  ["EGP", "Egyptian Pound"],
  ["ERN", "Nakfa"],
  ["ETB", "Ethiopian Birr"],
  ["EUR", "Euro"],
  ["FJD", "Fiji Dollar"],
  ["FKP", "Falkland Islands Pound"],
  ["GBP", "Pound Sterling"],
  ["GEL", "Lari"],
  ["GHS", "Ghana Cedi"],
  ["GIP", "Gibraltar Pound"],
  ["GMD", "Dalasi"],
  ["GNF", "Guinean Franc"],
  ["GTQ", "Quetzal"],
  ["GYD", "Guyana Dollar"],
  ["HKD", "Hong Kong Dollar"],
  ["HNL", "Lempira"],
  ["HTG", "Gourde"],
  ["HUF", "Forint"],
  ["IDR", "Rupiah"],
  ["ILS", "New Israeli Sheqel"],
  ["INR", "Indian Rupee"],
  ["IQD", "Iraqi Dinar"],
  ["IRR", "Iranian Rial"],
  ["ISK", "Iceland Krona"],
  ["JMD", "Jamaican Dollar"],
  ["JOD", "Jordanian Dinar"],
  ["JPY", "Yen"],
  ["KES", "Kenyan Shilling"],
  ["KGS", "Som"],
  ["KHR", "Riel"],
  ["KMF", "Comorian Franc"],
  ["KPW", "North Korean Won"],
  ["KRW", "Won"],
  ["KWD", "Kuwaiti Dinar"],
  ["KYD", "Cayman Islands Dollar"],
  ["KZT", "Tenge"],
  ["LAK", "Lao Kip"],
  ["LBP", "Lebanese Pound"],
  ["LKR", "Sri Lanka Rupee"],
  ["LRD", "Liberian Dollar"],
  ["LSL", "Loti"],
  ["LYD", "Libyan Dinar"],
  ["MAD", "Moroccan Dirham"],
  ["MDL", "Moldovan Leu"],
  ["MGA", "Malagasy Ariary"],
  ["MKD", "Denar"],
  ["MMK", "Kyat"],
  ["MNT", "Tugrik"],
  ["MOP", "Pataca"],
  ["MRU", "Ouguiya"],
  ["MUR", "Mauritius Rupee"],
  ["MVR", "Rufiyaa"],
  ["MWK", "Malawi Kwacha"],
  ["MXN", "Mexican Peso"],
  ["MXV", "Mexican Unidad de Inversion (UDI)"],
  ["MYR", "Malaysian Ringgit"],
  ["MZN", "Mozambique Metical"],
  ["NAD", "Namibia Dollar"],
  ["NGN", "Naira"],
  ["NIO", "Cordoba Oro"],
  ["NOK", "Norwegian Krone"],
  ["NPR", "Nepalese Rupee"],
  ["NZD", "New Zealand Dollar"],
  ["OMR", "Rial Omani"],
  ["PAB", "Balboa"],
  ["PEN", "Sol"],
  ["PGK", "Kina"],
  ["PHP", "Philippine Piso"],
  ["PKR", "Pakistan Rupee"],
  ["PLN", "Zloty"],
  ["PYG", "Guarani"],
  ["QAR", "Qatari Rial"],
  ["RON", "Romanian Leu"],
  ["RSD", "Serbian Dinar"],
  ["RUB", "Russian Ruble"],
  ["RWF", "Rwanda Franc"],
  ["SAR", "Saudi Riyal"],
  ["SBD", "Solomon Islands Dollar"],
  ["SCR", "Seychelles Rupee"],
  ["SDG", "Sudanese Pound"],
  ["SEK", "Swedish Krona"],
  ["SGD", "Singapore Dollar"],
  ["SHP", "Saint Helena Pound"],
  ["SLE", "Sierra Leone"],
  ["SOS", "Somali Shilling"],
  ["SRD", "Surinam Dollar"],
  ["SSP", "South Sudanese Pound"],
  ["STN", "Dobra"],
  ["SVC", "El Salvador Colon"],
  ["SYP", "Syrian Pound"],
  ["SZL", "Lilangeni"],
  ["THB", "Baht"],
  ["TJS", "Somoni"],
  ["TMT", "Turkmenistan New Manat"],
  ["TND", "Tunisian Dinar"],
  ["TOP", "Pa'anga"],
  ["TRY", "Turkish Lira"],
  ["TTD", "Trinidad and Tobago Dollar"],
  ["TWD", "New Taiwan Dollar"],
  ["TZS", "Tanzanian Shilling"],
  ["UAH", "Hryvnia"],
  ["UGX", "Uganda Shilling"],
  ["USD", "US Dollar"],
  ["USN", "US Dollar (Next day)"],
  ["UYI", "Uruguay Peso en Unidades Indexadas"],
  ["UYU", "Peso Uruguayo"],
  ["UYW", "Unidad Previsional"],
  ["UZS", "Uzbekistan Sum"],
  ["VED", "Bolivar Soberano, new valuation"],
  ["VES", "Bolivar Soberano"],
  ["VND", "Dong"],
  ["VUV", "Vatu"],
  ["WST", "Tala"],
  ["XAF", "CFA Franc BEAC"],
  ["XAG", "Silver"],
  ["XAU", "Gold"],
  ["XBA", "Bond Markets Unit European Composite Unit (EURCO)"],
  ["XBB", "Bond Markets Unit European Monetary Unit"],
  ["XBC", "Bond Markets Unit European Unit of Account 9"],
  ["XBD", "Bond Markets Unit European Unit of Account 17"],
  ["XCD", "East Caribbean Dollar"],
  ["XCG", "Caribbean guilder"],
  ["XDR", "SDR (Special Drawing Right)"],
  ["XOF", "CFA Franc BCEAO"],
  ["XPD", "Palladium"],
  ["XPF", "CFP Franc"],
  ["XPT", "Platinum"],
  ["XSU", "Sucre"],
  ["XTS", "Reserved for testing"],
  ["XUA", "ADB Unit of Account"],
  ["XXX", "No currency involved"],
  ["YER", "Yemeni Rial"],
  ["ZAR", "Rand"],
  ["ZMW", "Zambian Kwacha"],
  ["ZWG", "Zimbabwe Gold"],
  ],
};

/**
 * UN/ECE Recommendation 20 units of measure — the subset in ordinary
 * use, not the whole thing.
 *
 * **A deliberate subset, and stated as one.** Recommendation 20 runs to
 * hundreds of codes covering everything from becquerels to bushels.
 * Offering all of them in a dropdown makes finding `C62` harder, not
 * easier, and a person keying a freight invoice needs a dozen.
 *
 * This is the one list here that is **not** the standard in full, which
 * is why it says so: an unlisted code is still valid in a document, and
 * validation must not refuse one (decision 0113).
 */
export const UNECE_REC20_COMMON: CodeList = {
  id: "UNECERec20",
  agency: "UN/ECE",
  version: "Revision 11 (2015)",
  name: "Unit of measure",
  codes: [
    ["C62", "One (unit)"],
    ["EA", "Each"],
    ["H87", "Piece"],
    ["HUR", "Hour"],
    ["DAY", "Day"],
    ["MON", "Month"],
    ["ANN", "Year"],
    ["KGM", "Kilogram"],
    ["GRM", "Gram"],
    ["TNE", "Tonne (metric)"],
    ["LTR", "Litre"],
    ["MTR", "Metre"],
    ["MMT", "Millimetre"],
    ["CMT", "Centimetre"],
    ["KMT", "Kilometre"],
    ["MTK", "Square metre"],
    ["MTQ", "Cubic metre"],
    ["KWH", "Kilowatt hour"],
    ["NAR", "Number of articles"],
    ["SET", "Set"],
    ["PR", "Pair"],
    ["BX", "Box"],
    ["PF", "Pallet"],
    ["ZZ", "Mutually defined"],
  ],
};

/**
 * UNCL5305 VAT category codes, **as Peppol subsets them**.
 *
 * The full UN/CEFACT list is longer; BIS Billing 3.0 accepts these
 * eight, and each carries real consequences — `AE` and `K` shift who
 * accounts for the VAT, and `E` demands an exemption reason.
 */
export const UNCL5305_VAT_CATEGORY: CodeList = {
  id: "UNCL5305",
  agency: "UN/CEFACT",
  version: "D.16B",
  name: "VAT category",
  codes: [
    ["S", "Standard rate"],
    ["Z", "Zero rated goods"],
    ["E", "Exempt from tax"],
    ["AE", "VAT reverse charge"],
    ["K", "VAT exempt for intra-community supply of goods"],
    ["G", "Free export item, VAT not charged"],
    ["O", "Services outside scope of tax"],
    ["L", "Canary Islands general indirect tax"],
    ["M", "Tax for production, services and importation in Ceuta and Melilla"],
  ],
};

/**
 * Which field takes which list — decision 0113.
 *
 * **Only where the standard closes the value.** A field absent from
 * this map is free text by the specification's own design, and adding
 * it here would invent a restriction Peppol does not make.
 */
export const FIELD_CODE_LISTS: Record<string, CodeList> = {
  "BT-5": ISO_4217,
  "BT-130": UNECE_REC20_COMMON,
  "BT-151": UNCL5305_VAT_CATEGORY,
};

export const CODE_LISTS: CodeList[] = [ISO_4217, UNECE_REC20_COMMON, UNCL5305_VAT_CATEGORY];

/**
 * Whether a value is in a field's list.
 *
 * **Returns true for a field with no list**, because most fields have
 * none and "not restricted" is not the same as "invalid".
 *
 * `UNECERec20` is the exception this cannot check honestly: the list
 * above is a working subset, so a code outside it may still be a real
 * unit. Callers that must not refuse a valid document should use
 * `isClosedList` first.
 */
export function isValidCode(field: string, value: unknown): boolean {
  const list = FIELD_CODE_LISTS[field];
  if (!list) return true;
  if (typeof value !== "string") return false;
  return list.codes.some(([code]) => code === value);
}

/**
 * Whether a field's list is the standard in full.
 *
 * The difference matters: a value outside a **closed** list is
 * non-conformant, and a value outside a working subset is merely
 * unfamiliar.
 */
export function isClosedList(field: string): boolean {
  const list = FIELD_CODE_LISTS[field];
  return list !== undefined && list.id !== "UNECERec20";
}
