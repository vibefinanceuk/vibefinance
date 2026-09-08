import { t } from "/strings.js";
import { el } from "/tasks.js";

/**
 * The process, as a sequence — decisions 0149, 0151.
 *
 * **Chevrons rather than tabs**, because this is an order and the shape
 * should say so. A tab row says *"pick one of these"*; a sequence says
 * *"the document passes through these, in this order"*.
 *
 * Shared by the rules screen and the invoice viewer. Decision 0149 drew
 * it once for rules; the operator asked for the same display at the
 * head of the viewer, and **drawing it twice is drawing it twice**
 * — the argument decision 0149 already made about the icons.
 *
 * A stage with nothing at it is shown rather than hidden: somebody
 * wondering why nothing happens at Coding needs to see that Coding is
 * empty, which an omitted chevron cannot tell them.
 */
export function processRow(stages, currentId, onPick) {
  return el(
    "div",
    { class: "process" },
    stages.map((stage) => {
      const parts = [el("span", { text: stage.name })];

      /**
       * The line beneath, which differs by screen.
       *
       * On the rules screen it is how many rules run there. In the
       * viewer it is when the document arrived and how long it stayed —
       * **the operator's own idea**, and the data was already in
       * `stage_visits` waiting to be asked.
       */
      if (stage.detail) {
        parts.push(el("span", { class: "count", text: stage.detail }));
      }

      // A stage the document has not reached is dimmed rather than
      // hidden, so the sequence still reads as a whole.
      const classes = ["stage"];
      if (stage.id === currentId) classes.push("here");
      if (stage.state === "ahead") classes.push("ahead");
      if (stage.state === "behind") classes.push("behind");

      return el(
        onPick ? "button" : "div",
        {
          class: classes.join(" "),
          ...(onPick ? { onclick: () => onPick(stage.id) } : {}),
          // A stage visited more than once is worth saying out loud
          // rather than only counting (decision 0075's returns).
          ...(stage.visits > 1 ? { title: t("progress.revisited") } : {}),
        },
        parts
      );
    })
  );
}
