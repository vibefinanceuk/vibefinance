import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Active supplier count, by status — decision 0421, reusing
 * `/api/suppliers/status-counts` (decision 0378) inside the AP
 * Analytics Supplier Performance tab.
 */

function mountShell() {
  document.body.innerHTML = `<div id="card-under-test"></div>`;
}

const STRINGS = {
  locale: "en",
  strings: {
    "suppliers.statusheading": "Suppliers by status",
    "suppliers.nostatusdata": "No status data yet",
    "suppliers.status.active": "Active",
    "suppliers.status.onhold": "On hold",
    "suppliers.status.inactive": "Inactive",
    "suppliers.status.awaitingerp": "Awaiting the ERP",
  },
};

function stubStatus(counts: unknown, seen: string[] = []) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const path = String(url);
      seen.push(path);
      if (path.startsWith("/api/ui-strings")) return { ok: true, json: async () => STRINGS } as Response;
      if (path.startsWith("/api/suppliers/status-counts")) return { ok: true, json: async () => ({ counts }) } as Response;
      throw new Error(`no stub for ${path}`);
    })
  );
}

async function renderStatus(counts: unknown, seen: string[] = []) {
  stubStatus(counts, seen);
  const { loadStrings } = await import("/strings.js");
  await loadStrings();
  const { load, renderCard } = await import("/supplier-status.js");
  await load();
  document.getElementById("card-under-test")!.replaceChildren(renderCard());
}

beforeEach(() => {
  mountShell();
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the card the route returned", () => {
  it("titles the card with the same heading the standalone Suppliers screen already uses", async () => {
    await renderStatus({ active: 3, onhold: 1, inactive: 0, awaitingerp: 0 });
    expect(document.querySelector(".cardhead h3")?.textContent).toBe("Suppliers by status");
  });

  it("says there is no status data rather than drawing an empty ring", async () => {
    await renderStatus(null);
    expect(document.body.textContent).toContain("No status data yet");
    expect(document.querySelector("svg")).toBeNull();
  });

  it("draws a ring with one segment per non-zero status", async () => {
    await renderStatus({ active: 3, onhold: 1, inactive: 0, awaitingerp: 0 });
    const labels = [...document.querySelectorAll(".donutkey")].map((k) => k.textContent);
    expect(labels.some((l) => l?.includes("Active"))).toBe(true);
    expect(labels.some((l) => l?.includes("On hold"))).toBe(true);
    expect(labels.some((l) => l?.includes("Inactive"))).toBe(false);
  });

  it("asks the route for the chosen org, the same treatment every other analysis screen gives it", async () => {
    const seen: string[] = [];
    await renderStatus({ active: 1, onhold: 0, inactive: 0, awaitingerp: 0 }, seen);
    expect(seen.some((u) => u.startsWith("/api/suppliers/status-counts"))).toBe(true);
  });
});
