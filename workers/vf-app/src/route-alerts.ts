import type { RouteResult } from "./org-route.js";

/**
 * **Route alerts — decision 0559**, slice 5 of the Routes design
 * (`docs/design/routes-phase1-data-model.md` 3.10).
 *
 * An alert says who to tell, and when, for one route or every route:
 *
 * - **each failure**: a message that failed, or was only partly
 *   delivered, as soon as it is recorded;
 * - **a daily threshold**: when a route's failures today reach a number,
 *   once that day;
 * - **silence**: when a Source that has received before has received
 *   nothing for some hours, once for each silence. Checked on the
 *   Worker's schedule (every six hours), so a silence is noticed within
 *   six hours of passing its limit.
 *
 * Told by email, through Resend as Return To Supplier already sends
 * (0498), and/or by a webhook to the customer's own monitoring: JSON,
 * signed with the alert's own secret (`X-VibeFinance-Signature`, an
 * HMAC-SHA256 of the body), so the receiver can check it came from here.
 *
 * **What was sent is logged** (`route_alert_log`), so a threshold alerts
 * once a day and a silence once, however often they are checked, and a
 * message that fails again after a reprocess is not alerted twice.
 *
 * **Alerting never affects a message.** Every send is caught; a failure
 * to alert is logged with its outcome and changes nothing else.
 */

export interface AlertTransport {
  /** Null when email is not configured here (no Resend key or from address). */
  sendEmail: ((to: string[], subject: string, text: string) => Promise<{ ok: boolean; error?: string }>) | null;
  postWebhook: (url: string, secret: string, body: string) => Promise<{ ok: boolean; error?: string }>;
}

interface AlertRow {
  id: string;
  instance_id: string | null;
  on_failure: number;
  failures_per_day: number | null;
  silent_hours: number | null;
  emails: string | null;
  webhook_url: string | null;
  webhook_secret: string | null;
  created_at: string;
}

function emailsOf(value: string | null): string[] {
  return (value ?? "")
    .split(/[,;\s]+/)
    .map((e) => e.trim())
    .filter(Boolean);
}

async function hmacHex(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** The real transport: Resend for email, `fetch` for webhooks. */
export function alertTransport(env: { RESEND_API_KEY?: string; RESEND_FROM_ADDRESS?: string }): AlertTransport {
  return {
    sendEmail:
      env.RESEND_API_KEY && env.RESEND_FROM_ADDRESS
        ? async (to, subject, text) => {
            try {
              const response = await fetch("https://api.resend.com/emails", {
                method: "POST",
                headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
                body: JSON.stringify({ from: env.RESEND_FROM_ADDRESS, to, subject, text }),
              });
              return response.ok ? { ok: true } : { ok: false, error: `Resend refused the send (HTTP ${response.status})` };
            } catch (err) {
              return { ok: false, error: err instanceof Error ? err.message : String(err) };
            }
          }
        : null,
    postWebhook: async (url, secret, body) => {
      try {
        const response = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-VibeFinance-Signature": `sha256=${await hmacHex(secret, body)}` },
          body,
        });
        return response.ok ? { ok: true } : { ok: false, error: `the webhook answered HTTP ${response.status}` };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  };
}

interface AlertEvent {
  kind: "failure" | "threshold" | "silent" | "test";
  dedupeKey: string;
  subject: string;
  text: string;
  payload: Record<string, unknown>;
}

/** Sends one alert's event, once for its key. Returns what happened. */
async function deliver(db: D1Database, transport: AlertTransport, alert: AlertRow, event: AlertEvent): Promise<string> {
  const already = await db
    .prepare("SELECT 1 FROM route_alert_log WHERE alert_id = ? AND kind = ? AND dedupe_key = ?")
    .bind(alert.id, event.kind, event.dedupeKey)
    .first();
  if (already && event.kind !== "test") return "already_sent";

  const outcomes: string[] = [];
  const to = emailsOf(alert.emails);
  if (to.length > 0) {
    if (!transport.sendEmail) outcomes.push("email: not configured");
    else {
      const sent = await transport.sendEmail(to, event.subject, event.text);
      outcomes.push(sent.ok ? "email: sent" : `email: ${sent.error ?? "failed"}`);
    }
  }
  if (alert.webhook_url) {
    const body = JSON.stringify({ type: event.kind, alertId: alert.id, sentAt: new Date().toISOString(), ...event.payload });
    const posted = await transport.postWebhook(alert.webhook_url, alert.webhook_secret ?? "", body);
    outcomes.push(posted.ok ? "webhook: sent" : `webhook: ${posted.error ?? "failed"}`);
  }
  const outcome = outcomes.join(" · ").slice(0, 500) || "nothing to send";
  try {
    await db
      .prepare(
        `INSERT INTO route_alert_log (alert_id, kind, dedupe_key, sent_at, outcome) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (alert_id, kind, dedupe_key) DO UPDATE SET sent_at = excluded.sent_at, outcome = excluded.outcome`
      )
      .bind(alert.id, event.kind, event.dedupeKey, new Date().toISOString(), outcome)
      .run();
  } catch {
    // The alert went, or failed to; the log is secondary.
  }
  return outcome;
}

/** The alerts that apply to a route: its own, and those for every route. */
async function alertsFor(db: D1Database, instanceId: string | null): Promise<AlertRow[]> {
  return (
    await db
      .prepare("SELECT * FROM route_alerts WHERE instance_id IS NULL OR instance_id = ?")
      .bind(instanceId)
      .all<AlertRow>()
  ).results;
}

/**
 * **A message was recorded — tell anyone who asked.** Called once a
 * message is finished (received, or reprocessed). Says nothing unless it
 * failed or was only partly delivered.
 */
export async function notifyMessageFinished(db: D1Database, transport: AlertTransport, messageId: string): Promise<void> {
  try {
    const m = await db
      .prepare(
        `SELECT m.id, m.instance_id, m.status, m.failed_part, m.error_code, m.error_text, m.counterparty, m.subject, m.received_at,
                COALESCE(s.name, 'Unknown address') AS route_name
         FROM route_messages m LEFT JOIN sources s ON s.id = m.instance_id WHERE m.id = ?`
      )
      .bind(messageId)
      .first<{
        id: string;
        instance_id: string | null;
        status: string;
        failed_part: string | null;
        error_code: string | null;
        error_text: string | null;
        counterparty: string | null;
        subject: string | null;
        received_at: string;
        route_name: string;
      }>();
    if (!m || (m.status !== "failed" && m.status !== "partial")) return;

    const alerts = await alertsFor(db, m.instance_id);
    const what = m.status === "partial" ? "was only partly delivered" : `failed${m.failed_part ? ` at ${m.failed_part}` : ""}`;
    const message = {
      id: m.id,
      route: m.route_name,
      status: m.status,
      failedPart: m.failed_part,
      errorCode: m.error_code,
      reason: m.error_text,
      from: m.counterparty,
      subject: m.subject,
      receivedAt: m.received_at,
    };
    for (const alert of alerts.filter((a) => a.on_failure === 1)) {
      await deliver(db, transport, alert, {
        kind: "failure",
        dedupeKey: m.id,
        subject: `VibeFinance: a message on ${m.route_name} ${what}`,
        text: [
          `A message on the route ${m.route_name} ${what}.`,
          "",
          `Reference: ${m.id}`,
          `From: ${m.counterparty ?? "-"}`,
          `Subject: ${m.subject ?? "-"}`,
          `Reason: ${m.error_text ?? m.error_code ?? "-"}`,
          "",
          "Open the Route monitor in VibeFinance to see the message, its original files and how to fix it.",
        ].join("\n"),
        payload: { message },
      });
    }

    const today = m.received_at.slice(0, 10);
    for (const alert of alerts.filter((a) => a.failures_per_day !== null)) {
      const scope = alert.instance_id ? "AND instance_id = ?" : "";
      const count = await db
        .prepare(`SELECT count(*) AS n FROM route_messages WHERE status IN ('failed', 'partial') AND substr(received_at, 1, 10) = ? ${scope}`)
        .bind(today, ...(alert.instance_id ? [alert.instance_id] : []))
        .first<{ n: number }>();
      if ((count?.n ?? 0) < (alert.failures_per_day as number)) continue;
      const where = alert.instance_id ? m.route_name : "your routes";
      await deliver(db, transport, alert, {
        kind: "threshold",
        dedupeKey: today,
        subject: `VibeFinance: ${count?.n} failed messages today on ${where}`,
        text: `${count?.n} messages have failed today on ${where}, reaching the limit of ${alert.failures_per_day} set for this alert.\n\nOpen the Route monitor in VibeFinance to see them.`,
        payload: { day: today, failures: count?.n, limit: alert.failures_per_day, route: alert.instance_id ? m.route_name : null },
      });
    }
  } catch {
    // Deliberately silent: see the module comment.
  }
}

/**
 * **Routes that have gone quiet — decision 0559**, on the Worker's
 * schedule. A Source is quiet when it has received before and nothing
 * since `silent_hours` ago; it is alerted once for each silence (keyed by
 * its last message, so the next message ends that silence).
 */
export async function checkSilentRoutes(db: D1Database, transport: AlertTransport, now: Date = new Date()): Promise<number> {
  let sent = 0;
  try {
    const alerts = (await db.prepare("SELECT * FROM route_alerts WHERE silent_hours IS NOT NULL").all<AlertRow>()).results;
    for (const alert of alerts) {
      const sources = (
        await db
          .prepare(
            `SELECT s.id, s.name FROM sources s
             WHERE s.status = 'active' ${alert.instance_id ? "AND s.id = ?" : ""}`
          )
          .bind(...(alert.instance_id ? [alert.instance_id] : []))
          .all<{ id: string; name: string }>()
      ).results;
      for (const s of sources) {
        const last = await db
          .prepare("SELECT id, received_at FROM route_messages WHERE instance_id = ? ORDER BY received_at DESC LIMIT 1")
          .bind(s.id)
          .first<{ id: string; received_at: string }>();
        if (!last) continue; // Never received: not silent, just not started.
        const hours = (now.getTime() - Date.parse(last.received_at)) / 3600_000;
        if (hours < (alert.silent_hours as number)) continue;
        const outcome = await deliver(db, transport, alert, {
          kind: "silent",
          dedupeKey: `${s.id}:${last.id}`,
          subject: `VibeFinance: nothing received on ${s.name} for ${Math.floor(hours)} hours`,
          text: `The route ${s.name} has received nothing since ${last.received_at}, more than the ${alert.silent_hours} hours set for this alert.\n\nIf invoices are expected, check that mail still reaches its address.`,
          payload: { route: s.name, routeId: s.id, lastReceivedAt: last.received_at, silentHours: alert.silent_hours },
        });
        if (outcome !== "already_sent") sent += 1;
      }
    }
  } catch {
    // Deliberately silent: retried on the next schedule.
  }
  return sent;
}

function toBody(a: AlertRow, names: Map<string, string>) {
  return {
    id: a.id,
    routeId: a.instance_id,
    routeName: a.instance_id ? names.get(a.instance_id) ?? a.instance_id : null,
    onFailure: a.on_failure === 1,
    failuresPerDay: a.failures_per_day,
    silentHours: a.silent_hours,
    emails: emailsOf(a.emails),
    webhookUrl: a.webhook_url,
    // Shown to those who manage alerts, to set up the receiving end.
    webhookSecret: a.webhook_url ? a.webhook_secret : null,
    createdAt: a.created_at,
  };
}

async function routeNames(db: D1Database): Promise<Map<string, string>> {
  const rows = await db
    .prepare(
      `SELECT i.id, COALESCE(s.name, i.name) AS name FROM route_instances i LEFT JOIN sources s ON s.id = i.source_id`
    )
    .all<{ id: string; name: string }>();
  return new Map(rows.results.map((r) => [r.id, r.name]));
}

/** `GET /route-alerts` — every alert, with what each last sent. */
export async function handleListAlerts(db: D1Database): Promise<RouteResult> {
  const rows = (await db.prepare("SELECT * FROM route_alerts ORDER BY created_at").all<AlertRow>()).results;
  const names = await routeNames(db);
  const last = (
    await db
      .prepare(
        `SELECT l.alert_id, l.kind, l.sent_at, l.outcome FROM route_alert_log l
         WHERE l.sent_at = (SELECT max(sent_at) FROM route_alert_log x WHERE x.alert_id = l.alert_id)`
      )
      .all<{ alert_id: string; kind: string; sent_at: string; outcome: string }>()
  ).results;
  return {
    status: 200,
    body: {
      alerts: rows.map((a) => {
        const l = last.find((x) => x.alert_id === a.id);
        return { ...toBody(a, names), lastSent: l ? { kind: l.kind, at: l.sent_at, outcome: l.outcome } : null };
      }),
    },
  };
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** `POST /route-alerts` (new) and `PUT /route-alerts/:id` (change). */
export async function handleSaveAlert(
  db: D1Database,
  actor: string,
  body: Record<string, unknown>,
  id: string | null = null
): Promise<RouteResult> {
  const routeId = typeof body.routeId === "string" && body.routeId ? body.routeId : null;
  const onFailure = body.onFailure === true;
  const failuresPerDay = body.failuresPerDay === null || body.failuresPerDay === undefined || body.failuresPerDay === "" ? null : Number(body.failuresPerDay);
  const silentHours = body.silentHours === null || body.silentHours === undefined || body.silentHours === "" ? null : Number(body.silentHours);
  const emails = Array.isArray(body.emails) ? (body.emails as unknown[]).map(String).map((e) => e.trim()).filter(Boolean) : emailsOf(typeof body.emails === "string" ? body.emails : null);
  const webhookUrl = typeof body.webhookUrl === "string" && body.webhookUrl.trim() ? body.webhookUrl.trim() : null;

  const refuse = (reason: string, error: string) => ({ status: 400, body: { error, reason } });
  if (!onFailure && failuresPerDay === null && silentHours === null) return refuse("nothing_to_alert", "Choose when to alert.");
  if (failuresPerDay !== null && (!Number.isInteger(failuresPerDay) || failuresPerDay < 1)) return refuse("invalid_threshold", "The daily number must be a whole number from 1.");
  if (silentHours !== null && (!Number.isInteger(silentHours) || silentHours < 1 || silentHours > 720)) return refuse("invalid_silence", "The hours must be a whole number from 1 to 720.");
  if (emails.length === 0 && !webhookUrl) return refuse("no_recipient", "Give an email address or a webhook.");
  if (emails.some((e) => !EMAIL.test(e))) return refuse("invalid_email", "One of the email addresses is not an address.");
  if (webhookUrl && !/^https:\/\/[^\s]+$/.test(webhookUrl)) return refuse("invalid_webhook", "The webhook must be an https address.");
  if (routeId) {
    const route = await db.prepare("SELECT source_id FROM route_instances WHERE id = ?").bind(routeId).first<{ source_id: string | null }>();
    if (!route) return refuse("unknown_route", "That route does not exist.");
    // Silence is about receiving: a Destination sends.
    if (silentHours !== null && !route.source_id) return refuse("silence_needs_source", "Only a Source can go quiet.");
  }

  const created = !id;
  if (id) {
    const existing = await db.prepare("SELECT webhook_secret FROM route_alerts WHERE id = ?").bind(id).first<{ webhook_secret: string | null }>();
    if (!existing) return { status: 404, body: { error: `alert ${id} does not exist` } };
    const secret = webhookUrl ? existing.webhook_secret ?? newSecret() : null;
    await db
      .prepare(
        `UPDATE route_alerts SET instance_id = ?, on_failure = ?, failures_per_day = ?, silent_hours = ?, emails = ?, webhook_url = ?, webhook_secret = ?
         WHERE id = ?`
      )
      .bind(routeId, onFailure ? 1 : 0, failuresPerDay, silentHours, emails.join(", ") || null, webhookUrl, secret, id)
      .run();
  } else {
    id = crypto.randomUUID();
    await db
      .prepare(
        `INSERT INTO route_alerts (id, instance_id, on_failure, failures_per_day, silent_hours, emails, webhook_url, webhook_secret, created_at, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(id, routeId, onFailure ? 1 : 0, failuresPerDay, silentHours, emails.join(", ") || null, webhookUrl, webhookUrl ? newSecret() : null, new Date().toISOString(), actor)
      .run();
  }
  const row = await db.prepare("SELECT * FROM route_alerts WHERE id = ?").bind(id).first<AlertRow>();
  return { status: created ? 201 : 200, body: toBody(row as AlertRow, await routeNames(db)) };
}

function newSecret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return `whsec_${[...bytes].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
}

/** `DELETE /route-alerts/:id`. */
export async function handleDeleteAlert(db: D1Database, id: string): Promise<RouteResult> {
  const existing = await db.prepare("SELECT id FROM route_alerts WHERE id = ?").bind(id).first();
  if (!existing) return { status: 404, body: { error: `alert ${id} does not exist` } };
  await db.batch([
    db.prepare("DELETE FROM route_alert_log WHERE alert_id = ?").bind(id),
    db.prepare("DELETE FROM route_alerts WHERE id = ?").bind(id),
  ]);
  return { status: 200, body: { id, deleted: true } };
}

/** `POST /route-alerts/:id/test` — send a test now, and say what happened. */
export async function handleTestAlert(db: D1Database, transport: AlertTransport, id: string): Promise<RouteResult> {
  const alert = await db.prepare("SELECT * FROM route_alerts WHERE id = ?").bind(id).first<AlertRow>();
  if (!alert) return { status: 404, body: { error: `alert ${id} does not exist` } };
  const outcome = await deliver(db, transport, alert, {
    kind: "test",
    dedupeKey: "test",
    subject: "VibeFinance: a test route alert",
    text: "This is a test of a VibeFinance route alert. Nothing has failed.",
    payload: { test: true },
  });
  return { status: 200, body: { id, outcome } };
}
