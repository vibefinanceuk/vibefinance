import type { CompiledRule } from "../interpreter/types.js";

/**
 * The interface between the compiler and whatever language model
 * actually authors a rule. Deliberately narrow — one method, raw text
 * in, raw text out — so the model provider is a swappable detail behind
 * this interface, not something the compiler logic (prompt shape,
 * parsing, validation, refusal handling) has to know about.
 *
 * See docs/decisions/0002-compiler-model-choice.md for which
 * implementation is wired up today and why, and what the alternatives
 * were.
 */
export interface CompilerModel {
  compile(prompt: string): Promise<string>;
}

/**
 * What compiling a rule can produce. Refusal is first-class, not an
 * exception — see Blueprint, "Subsystem one": "the right output is
 * 'I can't express that, here is what I can do' — which is a product
 * conversation. A silently approximated rule is a liability."
 */
export type CompileOutcome =
  | {
      kind: "compiled";
      /** Missing id/version — the caller assigns those on persistence. */
      conditions: CompiledRule["conditions"];
      actions: CompiledRule["actions"];
      rawModelOutput: string;
    }
  | {
      kind: "refused";
      reason: string;
      rawModelOutput?: string;
    };
