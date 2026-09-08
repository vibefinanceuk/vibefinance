import { t } from "/strings.js";
import { el } from "/tasks.js";

/**
 * A compiled rule, read back in words — decision 0153.
 *
 * **The hard part of the whole screen.** Somebody wrote a sentence and
 * has to check the system understood it, and what it produced is
 * `{"field":"BT-40","operator":"is_not","value":"DE"}`. Showing that
 * asks them to learn EN 16931 to check their own English.
 *
 * So the rule is rendered as a sentence, with the Business Term
 * available on hover rather than in their face. **A customer who cannot
 * read the rule back cannot confirm it**, and the activation gate
 * (decision 0034) is worth nothing if the thing being confirmed is
 * unreadable.
 *
 * Every word here comes from the control plane (decision 0107): the
 * operators, the combinators and the actions are all keyed, so a German
 * customer reads a German sentence rather than English grammar with
 * German nouns in it.
 */

/**
 * What a field is called, in words.
 *
 * `/field-visibility` already serves a description per field, so the
 * screen has them without a second vocabulary — which is the property
 * decision 0031 protected by keeping one source of truth.
 *
 * **It serves only `INVOICE_FIELDS`**, though, so a derived field
 * rendered raw: `invoice.duplicate_confidence` beside `BT-112` reading
 * *"total with VAT"* (decision 0159). Derived fields are computed by
 * the platform and never keyed, so a screen about visibility had no
 * reason to mention them — and a screen about rules does.
 */
let descriptions = {};

export function useFieldDescriptions(fields, derived) {
  descriptions = {
    ...Object.fromEntries((fields ?? []).map((f) => [f.field, f.description ?? f.field])),
    ...(derived ?? {}),
  };
}

/**
 * Every field a rule actually tests — decision 0159.
 *
 * **Decision 0034 already does this**, walking the combinator tree to
 * build the worked-examples prompt from the fields the conditions
 * reference. The screen dumped all thirty instead, which made an
 * example a wall nobody could read.
 */
export function fieldsUsedBy(node, found = new Set()) {
  if (!node) return found;

  if (node.all || node.any) {
    for (const child of node.all ?? node.any) fieldsUsedBy(child, found);
    return found;
  }

  if (node.field) found.add(node.field);
  return found;
}

function fieldName(field) {
  return descriptions[field] ?? field;
}

/**
 * A value, as somebody would say it.
 *
 * A list reads as *"EUR, GBP or USD"* rather than as an array, because
 * a rule about three currencies is a sentence about three currencies.
 */
function valueText(value) {
  if (Array.isArray(value)) {
    if (value.length === 0) return "";
    if (value.length === 1) return String(value[0]);
    return `${value.slice(0, -1).join(", ")} ${t("readback.or")} ${value[value.length - 1]}`;
  }
  return String(value ?? "");
}

/** One condition, as a clause. */
function conditionClause(condition) {
  const term = el("span", {
    class: "term",
    text: fieldName(condition.field),
    // **The Business Term, available and not insisted upon.** An
    // auditor and an ERP vendor both use `BT-112`; the person writing
    // the rule does not have to.
    title: condition.field,
  });

  const clause = el("span", { class: "clause" }, [
    el("span", { text: `${t("readback.the")} ` }),
    term,
    el("span", { text: ` ${t(`operator.${condition.operator}`)}` }),
  ]);

  // `is_present` and `is_empty` take no value, and a trailing space
  // where one would go reads as something missing.
  const text = valueText(condition.value);
  if (text !== "") {
    clause.append(el("strong", { text: ` ${text}` }));
  }

  return clause;
}

/**
 * A combinator, and the clauses beneath it.
 *
 * **Nesting is bounded at five** (decision 0031's `MAX_COMBINATOR_DEPTH`
 * — so *"how deep can a rule go"* has a fixed answer), and this renders
 * whatever depth it is given rather than assuming one level.
 */
function combinatorClauses(node, depth = 0) {
  /**
   * **A rule may be one condition, with no combinator at all** —
   * decision 0158.
   *
   * The interpreter has always allowed it: `validateNode` falls through
   * to a single condition, and *"if the duplicate probability is over
   * 60%"* compiles to exactly that.
   *
   * This assumed a combinator, found no `all`, defaulted to `any`, and
   * rendered an empty list — **so the screen showed a rule with no
   * conditions when the rule had one.** Which is the trap decision 0153
   * exists to prevent: somebody confirming examples of a rule they
   * cannot correctly read.
   */
  if (!node.all && !node.any) {
    return [conditionClause(node)];
  }

  const kind = node.all ? "all" : "any";
  const children = node[kind] ?? [];

  const rows = [
    el("span", {
      class: "clause heading",
      text: depth === 0 ? t(`readback.when_${kind}`) : t(`readback.nested_${kind}`),
    }),
  ];

  for (const child of children) {
    if (child.all || child.any) {
      rows.push(
        el("div", { class: "nested" }, combinatorClauses(child, depth + 1))
      );
    } else {
      rows.push(conditionClause(child));
    }
  }

  return rows;
}

/** What the rule does when it matches. */
function actionClause(action) {
  return el("span", { class: "clause action" }, [
    el("strong", { text: t(`action.${action.type}`) }),
    ...(action.params && Object.keys(action.params).length > 0
      ? [
          el("span", {
            class: "muted",
            text: ` ${Object.values(action.params).join(", ")}`,
          }),
        ]
      : []),
  ]);
}

/**
 * The whole rule, read back.
 *
 * Placed **above** the worked examples deliberately, with a line telling
 * somebody to check it first: if the sentence was misunderstood,
 * confirming three correct examples of the wrong rule is exactly the
 * trap the activation gate is meant to prevent.
 */
export function readback(conditions, actions) {
  return el("div", { class: "readback" }, [
    ...combinatorClauses(conditions),
    el("span", { class: "clause then" }, [
      el("span", { text: `${t("readback.then")} ` }),
      ...actions.map(actionClause),
    ]),
  ]);
}

/**
 * A worked example's invoice, showing what the rule tests — decision
 * 0159.
 *
 * **It showed everything**, and an invoice carries thirty fields: a
 * wall of `BT-1 INV-2023-00456 · BT-3 380 · BT-5 USD · ...` in which
 * the one number the rule turns on is somewhere in the middle.
 *
 * Somebody confirming is being asked *"is this outcome right"*, and
 * they cannot answer without seeing **why** it came out that way.
 *
 * Decision 0034 already walks the combinator tree to build the prompt
 * from the fields a rule references. This uses the same idea for the
 * screen.
 *
 * The rest is kept and folded away rather than dropped: an example is
 * evidence, and evidence somebody cannot inspect is an assertion.
 */
export function exampleFacts(invoice, conditions) {
  const used = conditions ? fieldsUsedBy(conditions) : new Set();

  const decisive = Object.entries(invoice).filter(([field]) => used.has(field));
  const rest = Object.entries(invoice).filter(([field]) => !used.has(field));

  const say = ([field, value]) => `${fieldName(field)} ${value}`;

  const node = el("div", { class: "facts" }, [
    // What the rule turns on, first and in full.
    el("div", { class: "decisive", text: decisive.map(say).join(" · ") }),
  ]);

  if (rest.length > 0) {
    const more = el("details", { class: "morefacts" }, [
      el("summary", { text: t("compose.morefacts").replace("{n}", String(rest.length)) }),
      el("div", { class: "sm muted", text: rest.map(say).join(" · ") }),
    ]);
    node.append(more);
  }

  return node;
}
