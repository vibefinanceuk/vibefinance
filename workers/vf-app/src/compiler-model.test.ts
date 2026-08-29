import { describe, expect, it, vi } from "vitest";
import { createWorkersAiCompilerModel } from "./compiler-model.js";
import type { AiRunnable } from "./compiler-model.js";

describe("createWorkersAiCompilerModel — defensive response shape handling", () => {
  it("passes the prompt through as a chat message", async () => {
    const run = vi.fn().mockResolvedValue({ response: "ok" });
    const ai: AiRunnable = { run };
    const model = createWorkersAiCompilerModel(ai);
    await model.compile("test prompt");

    expect(run).toHaveBeenCalledTimes(1);
    const [modelId, input] = run.mock.calls[0];
    expect(typeof modelId).toBe("string");
    expect(input).toMatchObject({ messages: [{ role: "user", content: "test prompt" }] });
  });

  it("extracts text from the classic Workers AI { response } shape", async () => {
    const ai: AiRunnable = { run: vi.fn().mockResolvedValue({ response: "hello" }) };
    const model = createWorkersAiCompilerModel(ai);
    expect(await model.compile("x")).toBe("hello");
  });

  it("extracts text from the OpenAI Chat Completions { choices } shape", async () => {
    const ai: AiRunnable = {
      run: vi.fn().mockResolvedValue({
        choices: [{ message: { role: "assistant", content: "hello from choices" } }],
      }),
    };
    const model = createWorkersAiCompilerModel(ai);
    expect(await model.compile("x")).toBe("hello from choices");
  });

  it("extracts text from a nested { result: { response } } shape", async () => {
    const ai: AiRunnable = {
      run: vi.fn().mockResolvedValue({ result: { response: "nested hello" } }),
    };
    const model = createWorkersAiCompilerModel(ai);
    expect(await model.compile("x")).toBe("nested hello");
  });

  it("returns a raw string response as-is", async () => {
    const ai: AiRunnable = { run: vi.fn().mockResolvedValue("plain string response") };
    const model = createWorkersAiCompilerModel(ai);
    expect(await model.compile("x")).toBe("plain string response");
  });

  it("falls back to stringifying an unrecognised shape rather than throwing", async () => {
    const ai: AiRunnable = { run: vi.fn().mockResolvedValue({ totally_unexpected: 123 }) };
    const model = createWorkersAiCompilerModel(ai);
    const result = await model.compile("x");
    expect(result).toContain("totally_unexpected");
  });

  it("propagates an error from the AI binding rather than swallowing it", async () => {
    const ai: AiRunnable = { run: vi.fn().mockRejectedValue(new Error("AI binding error")) };
    const model = createWorkersAiCompilerModel(ai);
    await expect(model.compile("x")).rejects.toThrow("AI binding error");
  });
});
