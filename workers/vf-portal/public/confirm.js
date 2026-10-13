import { loadStrings, t, fill } from "/strings.js";

/**
 * **Confirming receipt of a purchase order — decision 0762.** The email's
 * link opens this page; once it has loaded in a browser it confirms, then
 * goes on to the order in the supplier network, where it shows as
 * confirmed. Someone not signed in sees it confirmed here, with the way
 * to sign in and see it. Dan, 13 October 2026: *"I would prefer the link
 * to confirm receipt and also take the user to the supplier network."*
 */

const $ = (id) => document.getElementById(id);

/** `#<environment>.<secret>` — which customer's instance, and the link's secret. Exported for its test. */
export function linkFromHash(hash) {
  const m = /^#([\w-]{1,100})\.([A-Za-z0-9_-]{20,100})$/.exec(hash ?? "");
  return m ? { environmentId: m[1], token: m[2] } : null;
}

/** Where the order opens in the supplier network. Exported for its test. */
export const orderAddress = (environmentId, orderId) => `/#order=${encodeURIComponent(environmentId)}/${encodeURIComponent(orderId)}`;

/** What the page says once confirmed. Exported for its test. */
export function confirmedWords(answer) {
  const words = [t(`network.confirm.done.${answer.kind ?? "order"}`, { number: answer.orderNumber ?? "", company: answer.company ?? "" })];
  if (answer.already && answer.at) words.push(t("network.confirm.already", { date: new Date(answer.at).toLocaleDateString() }));
  if (answer.current === false) words.push(t("network.confirm.older", { company: answer.company ?? "" }));
  return words;
}

async function confirm(link) {
  $("confirm-problem").textContent = "";
  $("confirm-again").hidden = true;
  $("confirm-status").textContent = t("network.confirm.working");
  const res = await fetch("/api/order-confirm", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(link) }).catch(() => null);
  const answer = res ? await res.json().catch(() => ({})) : {};
  if (!res?.ok) {
    $("confirm-status").textContent = "";
    $("confirm-problem").textContent = t(res?.status === 404 ? "network.confirm.invalid" : "network.confirm.failed");
    $("confirm-again").hidden = res?.status === 404;
    return;
  }
  const [done, ...more] = confirmedWords(answer);
  document.querySelector("main#confirm h1").textContent = t("network.confirm.titledone");
  $("confirm-status").textContent = done;
  $("confirm-more").textContent = more.join(" ");
  $("confirm-more").hidden = !more.length;
  const address = orderAddress(answer.environmentId ?? link.environmentId, answer.orderId);
  // Signed in already: straight on to the order, which shows it confirmed.
  const me = await fetch("/api/me").catch(() => null);
  if (me?.ok && answer.orderId && answer.current !== false) {
    $("confirm-more").textContent = [...more, t("network.confirm.opening")].join(" ");
    $("confirm-more").hidden = false;
    location.replace(address);
    return;
  }
  $("confirm-open").textContent = t(me?.ok ? "network.confirm.see" : "network.confirm.signin");
  $("confirm-open").onclick = () => location.assign(address);
  $("confirm-open").hidden = !answer.orderId;
}

export async function start() {
  await loadStrings();
  fill();
  $("confirm-again").textContent = t("network.confirm.again");
  const link = linkFromHash(location.hash);
  // The secret leaves the address bar at once; it is only needed once.
  history.replaceState?.(null, "", location.pathname);
  if (!link) {
    $("confirm-problem").textContent = t("network.confirm.invalid");
    return;
  }
  $("confirm-again").addEventListener("click", () => confirm(link));
  await confirm(link);
}

if (!globalThis.__VF_TEST__) start();
