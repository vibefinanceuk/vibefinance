import type { CompilerModel } from "@vibefinance/shared";

/**
 * See docs/decisions/0002-compiler-model-choice.md. Confirmed current
 * against Cloudflare's own Workers AI changelog (Aug 2026): gpt-oss
 * models explicitly support the Chat Completions message format this
 * calls with. Not confirmed against the real binding — this session has
 * no Cloudflare credentials, and Workers AI incurs real usage charges
 * even in local dev per Cloudflare's own docs, so there is no free way
 * to exercise this from a sandbox. Swappable behind CompilerModel
 * without touching shared/compiler/ if it needs to change.
 */
export const COMPILER_MODEL_ID = "@cf/openai/gpt-oss-120b";

/**
 * Narrower than @cloudflare/workers-types' generated Ai interface,
 * deliberately: that type's `run()` overloads are keyed to a closed set
 * of known model-id string literals, and this session can't confirm the
 * installed @cloudflare/workers-types version recognises
 * COMPILER_MODEL_ID specifically. A structural, duck-typed interface
 * avoids a build-time type error over something unverifiable here,
 * while the real env.AI binding satisfies this shape regardless.
 */
export interface AiRunnable {
  run(model: string, input: Record<string, unknown>): Promise<unknown>;
}

/**
 * Workers AI's response shape for a chat-style run() call is not
 * confirmed from this sandbox — different model families and Workers AI
 * API versions have used different shapes ({ response: string } is the
 * classic Workers AI shape; { choices: [{ message: { content } }] } is
 * the OpenAI Chat Completions shape gpt-oss models are documented to
 * also support). Handled defensively rather than assumed, so a shape
 * this wasn't written against still produces *something* for
 * parseModelOutput to work with (which itself treats unparseable input
 * as a refusal, never a crash) rather than throwing here.
 */
function extractResponseText(raw: unknown): string {
  if (typeof raw === "string") return raw;
  if (raw && typeof raw === "object") {
    const obj = raw as Record<string, unknown>;
    if (typeof obj.response === "string") return obj.response;
    const choices = obj.choices;
    if (Array.isArray(choices) && choices.length > 0) {
      const message = (choices[0] as Record<string, unknown> | undefined)?.message as
        | Record<string, unknown>
        | undefined;
      if (message && typeof message.content === "string") return message.content;
    }
    const result = obj.result;
    if (result && typeof result === "object") {
      const nested = (result as Record<string, unknown>).response;
      if (typeof nested === "string") return nested;
    }
  }
  // Last resort: hand parseModelOutput something to work with. Its own
  // JSON extraction will fail on this and correctly produce a refusal
  // with the raw shape visible in the reason, rather than this function
  // throwing on an unrecognised response shape.
  return JSON.stringify(raw);
}

export function createWorkersAiCompilerModel(ai: AiRunnable): CompilerModel {
  return {
    async compile(prompt: string): Promise<string> {
      const raw = await ai.run(COMPILER_MODEL_ID, {
        messages: [{ role: "user", content: prompt }],
      });
      return extractResponseText(raw);
    },
  };
}
