import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { applyTestSchema } from "./setup.js";
import { handleHelpAsk } from "../src/help-route.js";

/**
 * In-app Help's AI answer — decision 0518. The model is a stub that
 * records its prompt, so these tests prove what it is given and what it
 * is told, not what any real model would say.
 */

const USER = { id: "u-dan", email: "dan@x.com", name: "Dan" };

function stubModel(reply = "Because your limit is too low.") {
  const prompts: string[] = [];
  return { prompts, model: { compile: async (prompt: string) => (prompts.push(prompt), reply) } };
}

beforeEach(async () => {
  await applyTestSchema();
});

describe("handleHelpAsk", () => {
  it("400s on an empty question, without calling the model", async () => {
    const { prompts, model } = stubModel();
    const result = await handleHelpAsk(env.DB, model, USER as never, { question: "  " });
    expect(result.status).toBe(400);
    expect(prompts).toHaveLength(0);
  });

  it("400s on a question over 500 characters", async () => {
    const { model } = stubModel();
    const result = await handleHelpAsk(env.DB, model, USER as never, { question: "x".repeat(501) });
    expect(result.status).toBe(400);
  });

  it("grounds the model in the help text shown, tells it to use nothing else, and answers in the reader's language", async () => {
    const { prompts, model } = stubModel("Weil Ihr Limit zu niedrig ist.");
    const result = await handleHelpAsk(env.DB, model, USER as never, {
      question: "Why can't I complete this?",
      screen: "viewer",
      helpText: "Route To Approver: choose who should approve this invoice.",
      locale: "de",
    });
    expect(result).toEqual({ status: 200, body: { answer: "Weil Ihr Limit zu niedrig ist." } });
    expect(prompts[0]).toContain("using ONLY the HELP TEXT and LIVE FACTS");
    expect(prompts[0]).toContain("Route To Approver: choose who should approve this invoice.");
    expect(prompts[0]).toContain("Answer in German");
    expect(prompts[0]).toContain("QUESTION: Why can't I complete this?");
    expect(prompts[0]).toContain("(no task open)");
  });

  it("never passes on facts about a task the person cannot see", async () => {
    const { prompts, model } = stubModel();
    await handleHelpAsk(env.DB, model, USER as never, { question: "What now?", taskId: "no-such-task" });
    expect(prompts[0]).toContain("(no task open)");
  });
});
