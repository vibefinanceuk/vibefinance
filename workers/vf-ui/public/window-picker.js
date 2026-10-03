import { t } from "/strings.js";
import { el } from "/tasks.js";

/**
 * **A period to average over — decision 0617.** Dan: *Average handling
 * time* and *Claim-to-complete cycle time* averaged every task ever
 * completed, so last year's slow month weighed as much as this week. A
 * small choice in the card's heading: all time (as before, the default),
 * or the last 90, 30 or 7 days by when the task was completed. Documents
 * opened from the card keeps the same period.
 */
export const WINDOWS = [null, 90, 30, 7];

export function windowPicker(current, onChange) {
  return el(
    "select",
    {
      class: "windowpick",
      "aria-label": t("workload.window"),
      onchange: (e) => onChange(e.target.value ? Number(e.target.value) : null, e.target),
    },
    WINDOWS.map((days) => {
      const option = el("option", {
        value: days ? String(days) : "",
        text: days ? t("workload.window.days").replace("{n}", String(days)) : t("workload.window.all"),
      });
      if (days === current) option.selected = true;
      return option;
    })
  );
}

/** `?org=…&days=…`, either left out where not chosen. */
export function workloadQuery(org, days) {
  const params = new URLSearchParams();
  if (org) params.set("org", org);
  if (days) params.set("days", String(days));
  const q = params.toString();
  return q ? `?${q}` : "";
}
