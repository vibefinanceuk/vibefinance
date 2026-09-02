import type { UsageReport } from "@vibefinance/shared";
import { pushUsage } from "./usage.js";
import type { UsagePusher } from "./usage.js";

export interface UsagePushResult {
  status: number;
  body: { status: "pushed"; report: UsageReport } | { error: string; detail?: string };
}

/**
 * POST /usage/push's logic, separated from the fetch() handler so it
 * can be tested with a fake pusher against real D1 — same pattern as
 * compile-route.ts's handleCompileRequest. Not licence-gated,
 * deliberately: unlike /rules/evaluate and /rules/compile, a blocked
 * customer should still be able to report accurate usage — arguably
 * especially a blocked one, since accurate usage may be exactly what
 * a resolution conversation needs.
 */
export async function handleUsagePush(
  db: D1Database,
  environmentId: string,
  pusher: UsagePusher,
  now: Date = new Date()
): Promise<UsagePushResult> {
  try {
    const report = await pushUsage(db, now, environmentId, pusher);
    return { status: 200, body: { status: "pushed", report } };
  } catch (err) {
    return { status: 502, body: { error: "usage push failed", detail: String(err) } };
  }
}
