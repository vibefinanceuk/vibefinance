import { buildVocabularyDoc } from "./vocabulary-doc.js";
import { asResolved } from "../interpreter/vocabulary.js";
import type { VocabularyInput, VocabularyName } from "../interpreter/vocabulary.js";

/**
 * The exact two JSON shapes the model is allowed to produce. Kept as a
 * literal string block (not generated from a TS type) so it can be read
 * top-to-bottom as what the model actually sees, and so a change here
 * is a deliberate, reviewable diff rather than a side effect of an
 * unrelated type change.
 */
const OUTPUT_CONTRACT = `Respond with a single JSON object and nothing else — no markdown code
fences, no explanation before or after it. Two possible shapes:

If the sentence CAN be expressed in the vocabulary:
{
  "status": "compiled",
  "conditions": <a condition or a combinator, see below>,
  "actions": [ { "type": "<action>", "params": { ... } }, ... ]
}

A condition:
  { "field": "<field>", "operator": "<operator>", "value": <value or omitted for is_present/is_empty> }

A combinator (nests conditions or other combinators):
  { "all": [ <condition or combinator>, ... ] }   // AND
  { "any": [ <condition or combinator>, ... ] }   // OR

If the sentence CANNOT be expressed using only the vocabulary above:
{
  "status": "refused",
  "reason": "<a short, specific explanation of what's missing — this is shown to the person who wrote the sentence>"
}`;

const WORKED_EXAMPLE = `Example sentence: "When the buyer VAT id is missing and the seller is outside the EU, assign a task to the AP team requiring the AP.Approve permission"
Example output:
{
  "status": "compiled",
  "conditions": {
    "all": [
      { "field": "BT-48", "operator": "is_empty" },
      { "field": "BT-40", "operator": "not_in", "value": ["DE", "FR", "NL", "IE", "ES", "IT"] }
    ]
  },
  "actions": [ { "type": "assign_task", "params": { "team": "ap-team", "permission": "AP.Approve" } } ]
}
Note "ap-team" in the output above, not the words "AP team" from the
sentence: "team" is always a real team's id, resolved from the list
below if one is given — never a phrase copied out of the sentence,
however close it reads to a name.

A second example, showing route_to (advancing a process to a named
stage — never a team or queue, that meaning was retired):
Example sentence: "If the invoice is from a US supplier, skip straight to payment-eligible"
Example output:
{
  "status": "compiled",
  "conditions": { "field": "BT-40", "operator": "is", "value": "US" },
  "actions": [ { "type": "route_to", "params": { "stage": "payment-eligible" } } ]
}`;

const EXPENSE_WORKED_EXAMPLE = `Example sentence: "If the expense category is Travel and no receipt is attached, assign a task to the finance team requiring the Expense.Review permission"
Example output:
{
  "status": "compiled",
  "conditions": {
    "all": [
      { "field": "category", "operator": "is", "value": "Travel" },
      { "field": "receipt_attached", "operator": "is", "value": false }
    ]
  },
  "actions": [ { "type": "assign_task", "params": { "team": "finance-team", "permission": "Expense.Review" } } ]
}
Note "finance-team" in the output above, not the words "finance team"
from the sentence: "team" is always a real team's id, resolved from
the list below if one is given — never a phrase copied out of the
sentence, however close it reads to a name.`;

const SYSTEM_DESCRIPTION: Record<VocabularyName, string> = {
  invoice: "an invoice-processing system",
  expense: "an expense-management system",
  supplier: "a supplier-maintenance system",
};

export function buildCompilerPrompt(
  sourceText: string,
  vocabulary: VocabularyInput = "invoice",
  /**
   * What the stage this rule belongs to requires — decision 0210.
   *
   * **Decision 0200 taught the engine to fill a missing permission from
   * the stage and nobody taught the compiler that one could be
   * missing.** So a customer writing *"assign a task to the AP team"*
   * was refused — *"assign_task action requires a permission
   * parameter"* — and had to type a value the stage would have supplied
   * anyway, **and could type the wrong one.**
   *
   * Worst of both: the compiler demanded it, and the engine then
   * refused it if it disagreed.
   *
   * Null where the stage declares nothing, which is every stage today.
   */
  stagePermission: string | null = null,
  /**
   * The real `org_teams` rows a compiled `assign_task`'s `"team"` must
   * resolve to — the other half of the bug this parameter was added to
   * fix (see the note appended to WORKED_EXAMPLE/EXPENSE_WORKED_EXAMPLE
   * above). Before this, the model was never shown the real team ids at
   * all, so even a well-behaved model had nothing to resolve a sentence
   * like "the AP team" against and would echo the sentence's own words
   * instead — which is exactly what task-route.ts's `org_teams` lookup
   * then 404s on, silently dropping task creation (workflow-engine.ts
   * turns that into a swallowed 500).
   *
   * Empty where no teams are known to the caller — compile-route.ts
   * always fetches the real list, but keeping this optional keeps every
   * existing call site (and every existing test) valid.
   */
  teams: { id: string; name: string }[] = [],
  /**
   * The real `process_stages` rows a compiled `route_to`'s `"stage"`
   * must resolve to — the same bug as `teams` above, found independently
   * in a live rule ("route the invoice to AP Review" compiled to
   * `"stage": "AP Review"`, the stage's *name*, not its id `"review"`).
   * Unlike the assign_task/team bug, this one wasn't taught by a bad
   * worked example — WORKED_EXAMPLE already showed a real id
   * ("payment-eligible") — but the compiler still had no real stage
   * list to check a sentence's stage mention against, so it guessed.
   * `workflow-engine.ts` 422s a `route_to` naming an unknown stage
   * rather than silently dropping it, but that's still a rule that can
   * never actually route once it fires.
   *
   * Empty where no stages are known to the caller, same as `teams`.
   */
  stages: { id: string; name: string }[] = []
): string {
  const workedExample = vocabulary === "expense" ? EXPENSE_WORKED_EXAMPLE : WORKED_EXAMPLE;
  return `You are compiling a business rule for ${SYSTEM_DESCRIPTION[asResolved(vocabulary).name]}. A customer has described a rule in their own words. Your job is to translate it into a strict, closed vocabulary — never to write general-purpose code, and never to approximate something the vocabulary can't express.

${buildVocabularyDoc(vocabulary)}
${
  stagePermission
    ? `
THIS STAGE'S OWN PERMISSION: ${stagePermission}

Every task raised here requires it, and a rule may not ask for a different one — so if the sentence does not name a permission, use "${stagePermission}". If the sentence names a different one, that is a contradiction the author should be told about rather than a value to override.`
    : ""
}
${
  teams.length > 0
    ? `
REAL TEAMS (the only valid values for an assign_task action's "team"):
${teams.map((t) => `- "${t.id}" — ${t.name}`).join("\n")}

When the sentence names a team, resolve it to the matching id above by
meaning, not by copying its words — "the AP team" means the team named
"AP Team" in the list, so its id ("ap-team" here) is what belongs in
"team", never the literal phrase "AP team". If nothing in the list
plausibly matches what the sentence names, refuse rather than invent an
id: the actions vocabulary requires "team" to be one of the ids above.`
    : ""
}
${
  stages.length > 0
    ? `
REAL STAGES (the only valid values for a route_to action's "stage"):
${stages.map((s) => `- "${s.id}" — ${s.name}`).join("\n")}

When the sentence names a stage, resolve it to the matching id above by
meaning, not by copying its words — "route to AP Review" means the
stage named "AP Review" in the list, so its id (whatever that list
shows, not necessarily a lowercased version of the name) is what
belongs in "stage", never the display name itself. If nothing in the
list plausibly matches what the sentence names, refuse rather than invent
an id: route_to's "stage" must be one of the ids above.`
    : ""
}

${OUTPUT_CONTRACT}

${workedExample}

The customer's sentence:
"${sourceText}"

Respond with the JSON object now.`;
}
