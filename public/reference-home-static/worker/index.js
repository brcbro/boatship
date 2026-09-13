/* CohortIX worker: serves the static site and handles POST /api/book
   (sends the client a receipt email and the owner a new-booking alert via ZeptoMail). */
import { clientReceipt, ownerAlert } from "./emails.js";

// Booking rules — must match js/contact.js.
const SLOT_HOURS = [10, 11, 12, 13, 14, 15, 16, 17, 18]; // IST
const BOOK_AHEAD_DAYS = 45;
const NAME_RE = /^\p{L}[\p{L}\s.'-]*$/u;
const EMAIL_RE = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)*\.[a-z]{2,}$/i;
const PHONE_RE = /^\+?[\d\s\-().]+$/;
const IST_OFFSET_MS = 5.5 * 3600e3;

// Slot must be a real, future (1h notice), non-Sunday IST date within the booking window.
export function isSlotOpen(date, hour, now = Date.now()) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !SLOT_HOURS.includes(hour)) return false;
  const day = new Date(date + "T00:00:00Z");
  if (Number.isNaN(day.getTime()) || day.toISOString().slice(0, 10) !== date || day.getUTCDay() === 0) return false;
  const slotStart = day.getTime() + hour * 3600e3 - IST_OFFSET_MS;
  const todayIst = new Date(now + IST_OFFSET_MS).toISOString().slice(0, 10);
  const lastDay = new Date(todayIst + "T00:00:00Z").getTime() + BOOK_AHEAD_DAYS * 864e5;
  return slotStart > now + 3600e3 && day.getTime() <= lastDay;
}

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const str = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");

// Re-validate everything server-side: the browser checks are only a convenience.
function parseBooking(b) {
  const d = {
    name: str(b.name, 80), email: str(b.email, 120), phone: str(b.phone, 20),
    company: str(b.company, 120), message: str(b.message, 2000),
    date: str(b.date, 10), hour: Number(b.hour),
    services: Array.isArray(b.services) ? b.services.map((s) => str(s, 60)).filter(Boolean).slice(0, 8) : [],
    budget: str(b.budget, 40) || "Not specified", timeline: str(b.timeline, 40) || "Flexible",
  };
  const digits = d.phone.replace(/\D/g, "").length;
  const ok = d.name.length >= 2 && NAME_RE.test(d.name) && EMAIL_RE.test(d.email)
    && PHONE_RE.test(d.phone) && digits >= 10 && digits <= 15
    && d.message.length >= 10 && d.services.length > 0 && isSlotOpen(d.date, d.hour);
  if (!ok) return null;
  // built by hand: Intl punctuation differs between runtimes ("Tuesday, 15" vs "Tuesday 15")
  const dt = new Date(d.date + "T00:00:00Z");
  const part = (o) => dt.toLocaleDateString("en-GB", { timeZone: "UTC", ...o });
  d.dateLabel = `${part({ weekday: "long" })} ${dt.getUTCDate()} ${part({ month: "long" })} ${dt.getUTCFullYear()}`;
  d.time = `${((d.hour + 11) % 12) + 1}:00 ${d.hour < 12 ? "AM" : "PM"} IST`;
  return d;
}

// Defaults live here (not only wrangler.jsonc) because Cloudflare Pages ignores that file; env overrides.
const config = (env) => ({
  api: env.ZEPTOMAIL_API || "https://api.zeptomail.in/v1.1/email",
  from: env.MAIL_FROM || "noreply@cohortix.in",
  owner: env.OWNER_EMAIL || "paramrkalathiya@gmail.com",
});

async function sendMail(env, { to, subject, html, replyTo }) {
  const res = await fetch(config(env).api, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json", authorization: env.ZEPTOMAIL_TOKEN },
    body: JSON.stringify({
      from: { address: config(env).from, name: "CohortIX" },
      to: [{ email_address: to }],
      ...(replyTo && { reply_to: [replyTo] }),
      subject,
      htmlbody: html,
    }),
  });
  if (!res.ok) throw new Error(`ZeptoMail ${res.status}: ${await res.text()}`);
}

export async function handleBook(request, env) {
  let body;
  try { body = await request.json(); } catch { return json({ error: "Invalid request" }, 400); }
  if (body.website) return json({ ok: true }); // honeypot: bots fill hidden fields, humans don't
  const d = parseBooking(body);
  if (!d) return json({ error: "Please check the form and try again." }, 422);
  if (!env.ZEPTOMAIL_TOKEN) {
    console.error("ZEPTOMAIL_TOKEN secret is not set");
    return json({ error: "Booking email isn't configured yet." }, 500);
  }
  const { owner } = config(env);
  try {
    // Owner alert first: if only one can go out, it should be the one that tells you about the lead.
    await sendMail(env, { to: { address: owner, name: "CohortIX" }, subject: `New call booked: ${d.name}, ${d.dateLabel} ${d.time}`, html: ownerAlert(d), replyTo: { address: d.email, name: d.name } });
    await sendMail(env, { to: { address: d.email, name: d.name }, subject: `Your call with CohortIX is booked: ${d.dateLabel}, ${d.time}`, html: clientReceipt(d), replyTo: { address: owner, name: "CohortIX" } });
  } catch (err) {
    console.error(err);
    return json({ error: "We couldn't send the confirmation. Please book on WhatsApp instead." }, 502);
  }
  return json({ ok: true });
}

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (pathname === "/api/book") {
      return request.method === "POST" ? handleBook(request, env) : json({ error: "Method not allowed" }, 405);
    }
    return env.ASSETS.fetch(request);
  },
};
