/* Email HTML. Tables + inline styles because mail clients ignore most CSS. */

const esc = (s = "") =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const BG = "#edf4f5";
const SANS = "'Helvetica Neue',Helvetica,Arial,sans-serif";
const SERIF = "Georgia,'Times New Roman',serif";
const MONO = "'Fira Code',Menlo,Consolas,monospace";
const WHATSAPP = "https://wa.me/919016052410";
// absolute URL: mail clients can't resolve relative paths. Solid #060606 background, so it blends into the black receipt.
const LOGO = "https://cohortix.in/images/cohortix_wordmark_crop.png";

const mono = (text, extra = "") =>
  `<span style="font-family:${MONO};font-size:11px;letter-spacing:1px;text-transform:uppercase;${extra}">${text}</span>`;

const shell = (inner) => `<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0;padding:0;background:${BG};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BG};">
<tr><td align="center" style="padding:40px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;">${inner}</table>
</td></tr></table></body></html>`;

/* Client: the same receipt as /booked.html. */
export function clientReceipt(d) {
  const first = esc(d.name.split(" ")[0]);
  return shell(`
<tr><td style="background:#060606;color:${BG};border-radius:16px;padding:28px 24px 0;">
  <div style="text-align:center;padding:0 0 22px;">
    <img src="${LOGO}" width="150" height="46" alt="CohortIX" style="display:inline-block;width:150px;height:46px;border:0;outline:none;color:${BG};font-family:${SANS};font-size:22px;">
  </div>
  <div style="border-top:2px dashed #555;margin:0 -24px 20px;"></div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
    <td style="opacity:.7;">${mono("COH/CALL-30", `color:${BG};`)}</td>
    <td align="right" style="opacity:.7;">${mono("[ Booked ]", `color:${BG};`)}</td>
  </tr></table>
  <h1 style="margin:28px 0 14px;font-family:${SANS};font-weight:400;font-size:44px;line-height:1;letter-spacing:-1px;color:${BG};">Thank you, <em style="font-family:${SERIF};">${first}</em>.</h1>
  <p style="margin:0 0 26px;font-family:${SANS};font-size:16px;line-height:1.45;color:#b8bfc0;">Your call-back is pencilled in. We'll confirm on WhatsApp or email before the slot.</p>
  <div style="border-top:2px dashed #555;margin:0 -24px 20px;"></div>
  <p style="margin:0;color:#b8bfc0;">${mono(esc(d.services.join(" · ")))}</p>
  <p style="margin:16px 0 6px;font-family:${SERIF};font-style:italic;font-size:32px;line-height:1.05;color:${BG};">${esc(d.dateLabel)}</p>
  <p style="margin:0;">${mono(esc(d.time), `color:${BG};font-weight:bold;`)}</p>
  <div style="border-top:2px dashed #555;margin:20px -24px 0;padding:12px 24px;text-align:right;">${mono("Tear along line &#9656;&#9656;&#9656;", "color:#8a9091;")}</div>
</td></tr>
<tr><td style="padding:28px 0 0;">
  <a href="${WHATSAPP}" style="display:inline-block;background:#000;color:${BG};font-family:${SERIF};font-style:italic;font-size:20px;text-decoration:none;border-radius:999px;padding:14px 28px;">Confirm on WhatsApp &rarr;</a>
</td></tr>
<tr><td style="padding:28px 0 0;font-family:${SANS};font-size:13px;line-height:1.5;color:#555;">Need to change the slot? Just reply to this email.<br>CohortIX · Surat, Gujarat</td></tr>`);
}

/* Owner: every detail, reply goes straight to the client. */
export function ownerAlert(d) {
  const rows = [
    ["Slot", `${d.dateLabel}, ${d.time}`],
    ["Name", d.name],
    ["Company", d.company || "—"],
    ["Email", d.email],
    ["Phone", d.phone],
    ["Services", d.services.join(", ")],
    ["Budget", d.budget],
    ["Timeline", d.timeline],
    ["Project", d.message],
  ];
  const tel = d.phone.replace(/[^\d+]/g, "");
  return shell(`
<tr><td style="padding:0 0 12px;">${mono("[ New client call ]", "color:#ff0000;")}</td></tr>
<tr><td style="padding:0 0 20px;font-family:${SANS};font-size:32px;line-height:1.1;color:#000;">${esc(d.name)} booked <em style="font-family:${SERIF};">${esc(d.dateLabel)}</em>, ${esc(d.time)}</td></tr>
<tr><td style="background:#fff;border-radius:16px;padding:8px 24px;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
  ${rows.map(([k, v]) => `<tr>
    <td valign="top" style="padding:12px 16px 12px 0;border-bottom:1px solid #e3e8e9;width:90px;">${mono(k, "color:#777;")}</td>
    <td style="padding:12px 0;border-bottom:1px solid #e3e8e9;font-family:${SANS};font-size:15px;line-height:1.45;color:#000;white-space:pre-wrap;">${esc(v)}</td>
  </tr>`).join("")}
  </table>
</td></tr>
<tr><td style="padding:20px 0 0;font-family:${SANS};font-size:14px;color:#000;">
  <a href="mailto:${esc(d.email)}" style="color:#000;">Reply by email</a> ·
  <a href="https://wa.me/${esc(tel.replace("+", ""))}" style="color:#000;">WhatsApp</a> ·
  <a href="tel:${esc(tel)}" style="color:#000;">Call</a>
</td></tr>`);
}
