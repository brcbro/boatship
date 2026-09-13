/* Book a call page: reveal animations, IST call-back calendar, form. */
(function () {
  "use strict";

  const TZ = "Asia/Kolkata";
  const WHATSAPP = "919016052410";
  const SLOT_HOURS = [10, 11, 12, 13, 14, 15, 16, 17, 18]; // IST, hourly
  const BOOK_AHEAD_DAYS = 45;
  const $ = (id) => document.getElementById(id);

  /* ---- dates (all in IST, as YYYY-MM-DD strings) ------------------------- */
  const isoFmt = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" });
  const hourFmt = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const pad = (n) => String(n).padStart(2, "0");
  const iso = (y, m, d) => `${y}-${pad(m + 1)}-${pad(d)}`;
  const utc = (s) => new Date(s + "T00:00:00Z");
  const addDays = (s, n) => new Date(utc(s).getTime() + n * 864e5).toISOString().slice(0, 10);

  function istNow() {
    const [h, m] = hourFmt.format(new Date()).split(":").map(Number);
    return { date: isoFmt.format(new Date()), minutes: h * 60 + m };
  }

  const fmtLong = (s) => utc(s).toLocaleDateString("en-GB", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long" });
  const fmtHour = (h) => `${((h + 11) % 12) + 1}:00 ${h < 12 ? "AM" : "PM"}`;

  /* ---- reveal + word split (homepage "blur in" feel) -------------------- */
  function splitWords(el) {
    let i = 0;
    const walk = (node) => {
      [...node.childNodes].forEach((child) => {
        if (child.nodeType === Node.ELEMENT_NODE) return walk(child);
        const parts = child.textContent.split(/(\s+)/);
        const frag = document.createDocumentFragment();
        parts.forEach((p) => {
          if (!p.trim()) return frag.append(p);
          const w = document.createElement("span");
          w.className = "ct-word";
          w.style.setProperty("--i", i++);
          w.textContent = p;
          frag.append(w);
        });
        child.replaceWith(frag);
      });
    };
    walk(el);
    el.setAttribute("data-reveal", "");
  }

  function initReveal() {
    document.querySelectorAll("[data-split]").forEach(splitWords);
    const items = document.querySelectorAll("[data-reveal]");
    if (!("IntersectionObserver" in window)) return items.forEach((el) => el.classList.add("is-in"));
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (!e.isIntersecting) return;
        e.target.classList.add("is-in");
        io.unobserve(e.target);
      });
    }, { threshold: 0.15, rootMargin: "0px 0px -8% 0px" });
    items.forEach((el) => io.observe(el));
  }

  function initClock() {
    const el = $("ct-clock");
    const fmt = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", second: "2-digit" });
    const tick = () => { el.textContent = `Local time ${fmt.format(new Date())} (GMT+5:30)`; };
    tick();
    setInterval(tick, 1000);
  }

  /* ---- calendar ----------------------------------------------------------- */
  const state = { view: null, date: "", hour: null };

  const isSunday = (s) => utc(s).getUTCDay() === 0;
  const openSlots = (s) => {
    const now = istNow();
    return SLOT_HOURS.filter((h) => s !== now.date || h * 60 > now.minutes + 60); // 1h notice
  };
  function isBookable(s) {
    const today = istNow().date;
    return s >= today && s <= addDays(today, BOOK_AHEAD_DAYS) && !isSunday(s) && openSlots(s).length > 0;
  }

  function dayButton(s) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "ct-day";
    btn.textContent = Number(s.slice(8));
    btn.disabled = !isBookable(s);
    btn.dataset.date = s;
    btn.setAttribute("aria-label", fmtLong(s));
    btn.setAttribute("aria-pressed", String(s === state.date));
    if (s === istNow().date) btn.classList.add("is-today");
    return btn;
  }

  function renderCalendar() {
    const [y, m] = state.view;
    const first = utc(iso(y, m, 1));
    const days = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    const lead = (first.getUTCDay() + 6) % 7; // Monday-first
    const grid = $("ct-days");
    grid.replaceChildren();
    for (let i = 0; i < lead; i++) grid.append(document.createElement("span"));
    for (let d = 1; d <= days; d++) grid.append(dayButton(iso(y, m, d)));

    $("ct-month").textContent = first.toLocaleDateString("en-GB", { timeZone: "UTC", month: "long", year: "numeric" });
    const today = istNow().date;
    $("ct-prev").disabled = iso(y, m, 1) <= today.slice(0, 8) + "01";
    $("ct-next").disabled = iso(y, m, days) >= addDays(today, BOOK_AHEAD_DAYS);
  }

  function renderTimes() {
    const wrap = $("ct-times");
    wrap.replaceChildren();
    $("ct-times-label").textContent = state.date ? `Times on ${fmtLong(state.date)}` : "Pick a date first";
    if (!state.date) return;
    const open = openSlots(state.date);
    SLOT_HOURS.forEach((h) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "ct-time";
      btn.textContent = fmtHour(h);
      btn.dataset.hour = h;
      btn.disabled = !open.includes(h);
      btn.setAttribute("aria-pressed", String(h === state.hour));
      wrap.append(btn);
    });
  }

  function syncSlot() {
    $("callDate").value = state.date;
    $("callTime").value = state.hour === null ? "" : `${fmtHour(state.hour)} IST`;
    $("ct-ticket-date").innerHTML = state.date ? `<em>${fmtLong(state.date)}</em>` : "<em>No date yet</em>";
    $("ct-ticket-time").textContent = state.hour === null ? "— : —" : `${fmtHour(state.hour)} – ${fmtHour(state.hour + 1)} IST`;
    if ($("grp-slot").classList.contains("has-error")) showError("grp-slot");
  }

  function initCalendar() {
    const now = istNow().date;
    state.view = [Number(now.slice(0, 4)), Number(now.slice(5, 7)) - 1];
    const shift = (n) => {
      const d = new Date(Date.UTC(state.view[0], state.view[1] + n, 1));
      state.view = [d.getUTCFullYear(), d.getUTCMonth()];
      renderCalendar();
    };
    $("ct-prev").addEventListener("click", () => shift(-1));
    $("ct-next").addEventListener("click", () => shift(1));
    $("ct-days").addEventListener("click", (e) => {
      const btn = e.target.closest(".ct-day");
      if (!btn || btn.disabled) return;
      state.date = btn.dataset.date;
      state.hour = null;
      renderCalendar(); renderTimes(); syncSlot();
    });
    $("ct-times").addEventListener("click", (e) => {
      const btn = e.target.closest(".ct-time");
      if (!btn || btn.disabled) return;
      state.hour = Number(btn.dataset.hour);
      renderTimes(); syncSlot();
    });
    renderCalendar(); renderTimes(); syncSlot();
  }

  /* ---- form --------------------------------------------------------------- */
  const form = () => $("ct-form");
  const checked = (name) => [...form().querySelectorAll(`input[name="${name}"]:checked`)].map((i) => i.value);

  // Same limits as parseBooking() in worker/index.js — keep them in sync.
  const NAME_RE = /^\p{L}[\p{L}\s.'-]*$/u;
  const EMAIL_RE = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)*\.[a-z]{2,}$/i;
  const PHONE_RE = /^\+?[\d\s\-().]+$/;
  const val = (id) => $(id).value.trim();
  const digitCount = (s) => s.replace(/\D/g, "").length;

  // Each rule returns an error message, or "" when valid. Keys are in form order.
  const rules = {
    "grp-slot": () => (!state.date || state.hour === null ? "Pick a date and a time for your call."
      : !openSlots(state.date).includes(state.hour) ? "That slot is no longer available. Pick another time." : ""),
    "grp-fullName": () => {
      const v = val("fullName");
      if (v.length < 2) return "Enter your full name (at least 2 characters).";
      return NAME_RE.test(v) ? "" : "Use letters only (spaces, dots, apostrophes and hyphens are fine).";
    },
    "grp-email": () => (!val("email") ? "Enter your email address."
      : EMAIL_RE.test(val("email")) ? "" : "That email doesn't look right, e.g. rahul@company.com."),
    "grp-phone": () => {
      const v = val("phone");
      if (!v) return "Enter your phone or WhatsApp number.";
      if (!PHONE_RE.test(v)) return "Use digits only (+, spaces and dashes are fine).";
      const n = digitCount(v);
      return n >= 10 && n <= 15 ? "" : "Enter a 10-digit number, or include your country code.";
    },
    "grp-services": () => (checked("services").length ? "" : "Pick at least one service."),
    "grp-message": () => {
      const n = val("message").length;
      return n >= 10 ? "" : `Tell us a little more (${n} of 10 characters minimum).`;
    },
  };

  // Renders one group's error state; returns the message ("" = valid).
  function showError(id) {
    const group = $(id);
    const msg = rules[id]();
    group.classList.toggle("has-error", Boolean(msg));
    if (msg) group.querySelector(".ct-error").textContent = msg;
    group.querySelectorAll("input:not([type=checkbox]), textarea").forEach((el) => el.setAttribute("aria-invalid", String(Boolean(msg))));
    return msg;
  }

  function validate() {
    const bad = Object.keys(rules).filter(showError);
    if (!bad.length) return true;
    const first = bad[0] === "grp-slot" ? $("ct-cal") : $(bad[0]);
    first.scrollIntoView({ behavior: "smooth", block: "center" });
    first.querySelector("input:not([type=checkbox]), textarea")?.focus({ preventScroll: true });
    return false;
  }

  function bookingText(data) {
    return [
      "Hi CohortIX, I booked a call on your website:",
      "",
      `*Slot:* ${fmtLong(data.date)}, ${data.time}`,
      `*Name:* ${data.name}${data.company ? ` (${data.company})` : ""}`,
      `*Contact:* ${data.email} · ${data.phone}`,
      `*Services:* ${data.services.join(", ")}`,
      `*Budget / timeline:* ${data.budget} · ${data.timeline}`,
      "",
      `*Project:* ${data.message.slice(0, 300)}`,
    ].join("\n");
  }

  // Hand the receipt to /booked.html via sessionStorage (keeps personal data out of the URL).
  function showDone(data) {
    try {
      sessionStorage.setItem("ct-booking", JSON.stringify({
        firstName: data.name.split(" ")[0],
        dateLabel: fmtLong(data.date),
        time: data.time,
        services: data.services.join(" · "),
        waHref: `https://wa.me/${WHATSAPP}?text=${encodeURIComponent(bookingText(data))}`,
      }));
    } catch (e) {
      // storage blocked: fall back to WhatsApp so the booking isn't lost
      return location.assign(`https://wa.me/${WHATSAPP}?text=${encodeURIComponent(bookingText(data))}`);
    }
    location.assign("/booked.html");
  }

  function setSubmitError(msg) {
    const el = $("err-submit");
    el.textContent = msg;
    el.style.display = msg ? "block" : "";
  }

  // Worker emails the receipt to the client and an alert to CohortIX; only then show the receipt page.
  async function sendBooking(data) {
    const res = await fetch("/api/book", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...data, hour: state.hour, website: $("website").value }),
    });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Something went wrong.");
  }

  async function onSubmit(e) {
    e.preventDefault();
    if (!validate()) return;
    const data = {
      date: state.date,
      time: $("callTime").value,
      name: $("fullName").value.trim(),
      email: $("email").value.trim(),
      phone: $("phone").value.trim(),
      company: $("company").value.trim(),
      message: $("message").value.trim(),
      services: checked("services"),
      budget: checked("budget")[0] || "Not specified",
      timeline: checked("timeline")[0] || "Flexible",
    };
    const btn = $("ct-submit");
    btn.disabled = true;
    $("ct-submit-text").textContent = "Booking…";
    setSubmitError("");
    try {
      await sendBooking(data);
      showDone(data);
    } catch (err) {
      const msg = err instanceof TypeError ? "Couldn't reach the server." : err.message; // TypeError = network failure
      setSubmitError(`${msg} Or WhatsApp us: +91 90160 52410`);
      btn.disabled = false;
      $("ct-submit-text").textContent = "Schedule free call";
    }
  }

  function initForm() {
    form().addEventListener("submit", onSubmit);
    // Link each field to its error text for screen readers.
    Object.keys(rules).forEach((id) => {
      const err = $(id).querySelector(".ct-error");
      err.id = `${id}-err`;
      $(id).querySelectorAll("input:not([type=checkbox]), textarea").forEach((el) => el.setAttribute("aria-describedby", err.id));
    });
    // While a field shows an error, re-check as the user types so it clears (or updates) live.
    form().addEventListener("input", (e) => {
      const group = e.target.closest(".has-error");
      if (group && rules[group.id]) showError(group.id);
      if (e.target.id === "message") $("char-count").textContent = e.target.value.length;
    });
    // First check happens when leaving a field the user has typed in, not on every keystroke.
    form().addEventListener("focusout", (e) => {
      const group = e.target.closest("[id^='grp-']");
      if (group && rules[group.id] && e.target.type !== "checkbox" && e.target.value.trim()) showError(group.id);
    });
  }

  initReveal();
  initClock();
  initCalendar();
  initForm();
})();
