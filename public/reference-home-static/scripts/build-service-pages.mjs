import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const SITE = "https://cohortix.in";

const esc = (s = "") =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
           .replace(/"/g, "&quot;");

const common = JSON.parse(readFileSync(join(ROOT, "data/common.json"), "utf8"));
const template = readFileSync(join(ROOT, "templates/service-page.html"), "utf8");

// ---- section renderers -------------------------------------------------
const renderHero = (p) => `
  <header class="svc-hero">
    <div class="svc-wrap">
      <h1>${esc(p.h1)}</h1>
      <p class="svc-hero__sub">${esc(p.heroSub)}</p>
      <p class="svc-hero__intro">${esc(p.intro)}</p>
      <a class="svc-btn svc-btn--primary" href="${common.cta.quote}">${esc(common.cta.primaryLabel)}</a>
    </div>
  </header>`;

const renderOfferings = (p) => `
  <section class="svc-section">
    <div class="svc-wrap">
      <h2>${esc(p.offeringsHeading)}</h2>
      <div class="svc-grid">
        ${p.offerings.map((o) => `
        <article class="svc-card">
          <h3>${esc(o.title)}</h3>
          <p>${esc(o.body)}</p>
        </article>`).join("")}
      </div>
    </div>
  </section>`;

const renderWhy = (p) => `
  <section class="svc-section svc-section--alt">
    <div class="svc-wrap">
      <h2>Why choose CohortIX for ${esc(p.whyKeyword)}</h2>
      <ul class="svc-list">
        ${common.whyChoose.map((w) => `<li><strong>${esc(w.title)}</strong> ${esc(w.body)}</li>`).join("")}
      </ul>
    </div>
  </section>`;

const renderProcess = () => `
  <section class="svc-section">
    <div class="svc-wrap">
      <h2>How we work</h2>
      <ol class="svc-steps">
        ${common.process.map((s) => `<li><strong>${esc(s.title)}</strong> ${esc(s.body)}</li>`).join("")}
      </ol>
    </div>
  </section>`;

const renderIndustries = () => `
  <section class="svc-section svc-section--alt">
    <div class="svc-wrap">
      <h2>Industries we serve in Surat</h2>
      <p>${esc(common.industries.intro)}</p>
      <ul class="svc-chips">
        ${common.industries.items.map((i) => `<li>${esc(i)}</li>`).join("")}
      </ul>
    </div>
  </section>`;

const renderRelated = (p, all) => `
  <section class="svc-section svc-section--alt">
    <div class="svc-wrap">
      <h2>Other services in Surat</h2>
      <div class="svc-grid">
        ${all.filter((o) => o.slug !== p.slug).map(serviceCard).join("")}
      </div>
    </div>
  </section>`;

const serviceCard = (o) => `
        <a class="svc-card" href="/services/${o.slug}">
          <h3>${esc(o.h1)}</h3>
          <p>${esc(o.heroSub)}</p>
        </a>`;

// Homepage services section was removed per request; footer still lists service links/NAP.
// ponytail: kept as a no-op (not deleted) so the svc:services marker in index.html still resolves.
const renderHomeServices = () => "";

const renderFooterSeo = (all) => {
  const b = common.brand;
  return `
    <div class="svc-footer">
      <nav class="svc-footer__links" aria-label="Services">
        ${all.map((o) => `<a href="/services/${o.slug}">${esc(o.serviceType)}</a>`).join("")}
        <a href="/work/">Case studies &amp; portfolio</a>
      </nav>
      <address class="svc-footer__nap">
        <strong>CohortIX</strong><br>
        ${b.streetAddress ? esc(b.streetAddress) + ", " : ""}Surat, Gujarat${b.postalCode ? " " + esc(b.postalCode) : ""}, India<br>
        <a href="tel:${b.telephone}">${esc(b.telephoneDisplay)}</a> ·
        <a href="mailto:${b.email}">${esc(b.email)}</a>
      </address>
      <nav class="svc-footer__legal" aria-label="Legal">
        <a href="/privacy-policy">Privacy Policy</a>
        <a href="/terms-and-conditions">Terms &amp; Conditions</a>
        <a href="/refund-policy">Refund &amp; Cancellation</a>
        <a href="/delivery-policy">Service Delivery</a>
        <a href="/cookie-policy">Cookie Policy</a>
        <a href="/disclaimer">Disclaimer</a>
      </nav>
    </div>`;
};

const renderFaq = (p) => `
  <section class="svc-section">
    <div class="svc-wrap">
      <h2>Frequently asked questions</h2>
      <div class="svc-faq">
        ${p.faq.map((f) => `
        <details class="svc-faq__item">
          <summary>${esc(f.q)}</summary>
          <p>${esc(f.a)}</p>
        </details>`).join("")}
      </div>
    </div>
  </section>`;

const renderCta = () => `
  <section class="svc-section svc-cta">
    <div class="svc-wrap">
      <h2>${esc(common.cta.heading)}</h2>
      <p>${esc(common.cta.body)}</p>
      <a class="svc-btn svc-btn--primary" href="${common.cta.quote}">${esc(common.cta.primaryLabel)}</a>
      <a class="svc-btn svc-btn--ghost" href="${common.cta.email}">${esc(common.cta.secondaryLabel)}</a>
    </div>
  </section>`;

// Big closing line above the footer. `html` is trusted copy from data/*.json and may contain <em>.
const renderClosing = (html) => `
  <section class="svc-close">
    <div class="svc-wrap">
      <h2>${html}</h2>
      <p class="svc-close__mono">${esc(common.closing.lead)} <a href="${common.cta.whatsapp}" target="_blank" rel="noopener">WhatsApp ${esc(common.brand.telephoneDisplay)}</a></p>
    </div>
  </section>`;

// ---- case studies ------------------------------------------------------
const imgPath = (w) => `/images/${encodeURIComponent(w.image)}`;

const workCard = (w) => `
        <a class="svc-card svc-card--work" href="/work/${w.slug}">
          <img src="${imgPath(w)}" alt="${esc(w.name)} — ${esc(w.tag)}" width="1024" height="1024" loading="lazy">
          <h3>${esc(w.name)}</h3>
          <p>${esc(w.tag)}</p>
        </a>`;

const workGridSection = (heading, list) => list.length === 0 ? "" : `
  <section class="svc-section">
    <div class="svc-wrap">
      <h2>${heading}</h2>
      <div class="svc-grid">${list.map(workCard).join("")}
      </div>
      <p class="svc-more"><a href="/work/">See all case studies →</a></p>
    </div>
  </section>`;

const renderWorkHero = (w) => `
  <header class="svc-hero">
    <div class="svc-wrap svc-work-hero">
      <div>
        <p class="svc-eyebrow"><a href="/work/">Case study</a> · ${esc(w.industry)}${w.location ? " · " + esc(w.location) : ""}</p>
        <h1>${esc(w.name)} <br><span class="italic-text">${esc(w.tag)}</span></h1>
        <p class="svc-hero__intro">${esc(w.summary)}</p>
        <a class="svc-btn svc-btn--primary" href="${w.url}" target="_blank" rel="noopener">Visit live site ↗</a>
        <a class="svc-btn svc-btn--ghost" href="${common.cta.quote}">Build something similar</a>
      </div>
      <img src="${imgPath(w)}" alt="${esc(w.name)} website by CohortIX" width="1024" height="1024" fetchpriority="high">
    </div>
  </header>`;

const renderWorkServices = (w, bySlug) => `
  <section class="svc-section svc-section--alt">
    <div class="svc-wrap">
      <h2>Services on this project</h2>
      <div class="svc-grid">${w.services.map((slug) => serviceCard(bySlug[slug])).join("")}
      </div>
    </div>
  </section>`;

// results stay hidden until real outcomes are added to data/work/<slug>.json
const renderWorkResults = (w) => w.results.length ? `
  <section class="svc-section">
    <div class="svc-wrap">
      <h2>Results</h2>
      <ul class="svc-list">${w.results.map((r) => `<li>${esc(r)}</li>`).join("")}</ul>
    </div>
  </section>` : "";

const renderWorkIndex = (list) => `
  <header class="svc-hero">
    <div class="svc-wrap">
      <h1>Our <span class="italic-text">work</span></h1>
      <p class="svc-hero__sub">Websites, apps, SaaS products and AI tools designed and built by CohortIX in Surat.</p>
    </div>
  </header>
  <section class="svc-section">
    <div class="svc-wrap">
      <div class="svc-grid">${list.map(workCard).join("")}
      </div>
    </div>
  </section>${renderCta()}`;

const jsonLdTag = (obj) => `<script type="application/ld+json">${JSON.stringify(obj, null, 2)}</script>`;

const breadcrumbs = (trail) => ({
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  itemListElement: trail.map(([name, item], i) => ({ "@type": "ListItem", position: i + 1, name, item })),
});

const buildWorkJsonLd = (w, canonical) => jsonLdTag({
  "@context": "https://schema.org",
  "@type": "CreativeWork",
  name: `${w.name}: ${w.tag}`,
  url: canonical,
  image: SITE + imgPath(w),
  description: w.summary,
  genre: w.industry,
  sameAs: w.url,
  creator: { "@id": `${SITE}/#business` },
}) + jsonLdTag(breadcrumbs([["Home", `${SITE}/`], ["Work", `${SITE}/work/`], [w.name, canonical]]));

// ---- JSON-LD (generated from the same data, so it never drifts) --------
const buildJsonLd = (p, canonical) => {
  const brand = common.brand;
  const service = {
    "@context": "https://schema.org",
    "@type": "ProfessionalService",
    name: "CohortIX",
    image: `${SITE}/images/cohortix-logo-with-text.png`,
    "@id": `${SITE}/#business`,
    url: canonical,
    telephone: brand.telephone,
    priceRange: "₹₹",
    address: {
      "@type": "PostalAddress",
      // empty fields are dropped by JSON.stringify(undefined) rather than shipping blanks
      streetAddress: brand.streetAddress || undefined,
      addressLocality: "Surat",
      addressRegion: "Gujarat",
      postalCode: brand.postalCode || undefined,
      addressCountry: "IN",
    },
    email: brand.email,
    areaServed: ["Surat", "Adajan", "Vesu", "Varachha", "Katargam", "Piplod"]
      .map((n) => ({ "@type": "Place", name: n })),
    serviceType: p.serviceType,
    description: p.meta.description,
    sameAs: brand.sameAs,
  };
  const faq = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: p.faq.map((f) => ({
      "@type": "Question",
      name: f.q,
      acceptedAnswer: { "@type": "Answer", text: f.a },
    })),
  };
  return `${jsonLdTag(service)}\n${jsonLdTag(faq)}`;
};

// ---- data -------------------------------------------------------------
const loadDir = (sub) => readdirSync(join(ROOT, sub)).filter((f) => f.endsWith(".json")).map((file) => ({
  ...JSON.parse(readFileSync(join(ROOT, sub, file), "utf8")),
  mtime: statSync(join(ROOT, sub, file)).mtime,
}));
const all = loadDir("data/services");
const works = loadDir("data/work").sort((a, b) => a.order - b.order);
const serviceBySlug = Object.fromEntries(all.map((p) => [p.slug, p]));
const footerSeo = renderFooterSeo(all);

const writePage = (relPath, m) => {
  const html = template
    .replaceAll("{{META_TITLE}}", esc(m.title))
    .replaceAll("{{META_DESCRIPTION}}", esc(m.description))
    .replaceAll("{{OG_TITLE}}", esc(m.ogTitle ?? m.title))
    .replaceAll("{{OG_DESCRIPTION}}", esc(m.ogDescription ?? m.description))
    .replaceAll("{{OG_IMAGE}}", m.ogImage ?? `${SITE}/images/cohortix-og.png`)
    .replaceAll("{{CANONICAL}}", m.canonical)
    // function replacements: bodies contain JS, and "$'"-style patterns in a
    // replacement string would otherwise be expanded
    .replace("{{HEAD_EXTRA}}", () => m.head ?? "")
    .replace("{{JSON_LD}}", () => m.jsonLd)
    .replace("{{BODY}}", () => m.body)
    .replace("{{CLOSING}}", () => (m.closing ? renderClosing(m.closing) : ""))
    .replace("{{FOOTER_SEO}}", () => footerSeo);
  const out = join(ROOT, relPath);
  mkdirSync(join(out, ".."), { recursive: true });
  writeFileSync(out, html);
  console.log("built " + relPath);
};

// ---- service pages -----------------------------------------------------
for (const p of all) {
  const canonical = `${SITE}/services/${p.slug}`;
  writePage(`services/${p.slug}.html`, {
    ...p.meta, canonical,
    closing: p.closing,
    jsonLd: buildJsonLd(p, canonical),
    body: [
      renderHero(p), renderOfferings(p), renderWhy(p), renderProcess(), renderIndustries(),
      workGridSection("Recent work", works.filter((w) => w.services.includes(p.slug)).slice(0, 3)),
      renderFaq(p), renderRelated(p, all), renderCta(),
    ].join(""),
  });
}
// ---- case studies ------------------------------------------------------
works.forEach((w, i) => {
  const canonical = `${SITE}/work/${w.slug}`;
  const more = [1, 2, 3].map((k) => works[(i + k) % works.length]);
  writePage(`work/${w.slug}.html`, {
    title: `${w.name}: ${w.tag} | CohortIX`,
    description: w.summary.length > 155 ? w.summary.slice(0, w.summary.lastIndexOf(" ", 152)) + "…" : w.summary,
    ogImage: SITE + imgPath(w),
    canonical,
    closing: w.closing,
    jsonLd: buildWorkJsonLd(w, canonical),
    body: [renderWorkHero(w), renderWorkServices(w, serviceBySlug), renderWorkResults(w), workGridSection("More work", more), renderCta()].join(""),
  });
});

writePage("work/index.html", {
  title: "Our Work — Websites, Apps & Software Built by CohortIX, Surat",
  description: "Case studies from CohortIX: e-commerce stores, SaaS products, booking apps, POS systems and AI automation tools we have designed and built.",
  canonical: `${SITE}/work/`,
  closing: common.closing.workIndex,
  jsonLd: jsonLdTag(breadcrumbs([["Home", `${SITE}/`], ["Work", `${SITE}/work/`]])),
  body: renderWorkIndex(works),
});

// ---- book a call -------------------------------------------------------
writePage("contact.html", {
  title: "Book a Call — Pick Your Call-Back Slot | CohortIX, Surat",
  description: "Book a free 30-minute call with CohortIX. Pick a date and time, share your brief, and get a realistic scope for your website, app or software within 24 hours.",
  canonical: `${SITE}/contact`,
  head: `<link rel="stylesheet" href="/css/contact.css?v=5">
  <script>document.documentElement.classList.add("ct-js")</script>`,
  jsonLd: jsonLdTag({
    "@context": "https://schema.org",
    "@type": "ContactPage",
    name: "Book a call with CohortIX",
    url: `${SITE}/contact`,
    about: { "@id": `${SITE}/#business` },
  }) + jsonLdTag(breadcrumbs([["Home", `${SITE}/`], ["Book a call", `${SITE}/contact`]])),
  body: readFileSync(join(ROOT, "templates/contact-body.html"), "utf8"),
});

writePage("booked.html", {
  title: "Call Booked | CohortIX",
  description: "Your free call with CohortIX is booked. We'll confirm on WhatsApp or email before the slot.",
  canonical: `${SITE}/booked`,
  closing: common.closing.booked,
  head: `<meta name="robots" content="noindex">
  <link rel="stylesheet" href="/css/contact.css?v=5">`,
  jsonLd: "",
  body: readFileSync(join(ROOT, "templates/booked-body.html"), "utf8"),
});

// ---- legal & compliance pages ------------------------------------------
const legal = JSON.parse(readFileSync(join(ROOT, "data/legal.json"), "utf8"));
const legalFacts = {
  ...legal.facts,
  ADDRESS: `${common.brand.streetAddress}, Surat, Gujarat ${common.brand.postalCode}, India`,
  EMAIL: common.brand.email,
  PHONE: common.brand.telephoneDisplay,
  PHONE_TEL: common.brand.telephone,
};
const fillLegal = (html, file) =>
  html.replace(/\{\{([A-Z_]+)\}\}/g, (tag, key) => {
    if (!(key in legalFacts)) throw new Error(`${file}: unknown placeholder ${tag}`);
    return esc(legalFacts[key]);
  });

for (const page of legal.pages) {
  const canonical = `${SITE}/${page.slug}`;
  const file = `templates/legal/${page.slug}.html`;
  writePage(`${page.slug}.html`, {
    title: page.title,
    description: page.description,
    canonical,
    closing: page.closing,
    jsonLd: jsonLdTag({
      "@context": "https://schema.org",
      "@type": "WebPage",
      name: page.h1,
      url: canonical,
      dateModified: legal.facts.EFFECTIVE,
      publisher: { "@id": `${SITE}/#business` },
    }) + jsonLdTag(breadcrumbs([["Home", `${SITE}/`], [page.h1, canonical]])),
    body: `
  <header class="svc-hero svc-hero--legal">
    <div class="svc-wrap">
      <h1>${esc(page.h1)}</h1>
      <p class="svc-eyebrow">Last updated: ${esc(legal.facts.EFFECTIVE)}</p>
    </div>
  </header>
  <section class="svc-section">
    <div class="svc-wrap">
      <article class="svc-legal">${fillLegal(readFileSync(join(ROOT, file), "utf8"), file)}</article>
    </div>
  </section>`,
  });
}

// ---- homepage: replace generated blocks between marker comments ---------
const inject = (html, name, content) => {
  const re = new RegExp(`<!-- svc:${name} -->[\\s\\S]*?<!-- /svc:${name} -->`);
  if (!re.test(html)) throw new Error(`index.html missing <!-- svc:${name} --> markers`);
  return html.replace(re, () => `<!-- svc:${name} -->${content}\n    <!-- /svc:${name} -->`);
};
const homePath = join(ROOT, "index.html");
const home = readFileSync(homePath, "utf8");
const b = common.brand;
const homeJsonLd = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "ProfessionalService",
      "@id": `${SITE}/#business`,
      name: "CohortIX",
      url: `${SITE}/`,
      logo: `${SITE}/images/cohortix-logo-with-text.png`,
      image: `${SITE}/images/cohortix-logo-with-text.png`,
      description: "Custom software, website, mobile app, UI/UX, digital marketing and AI automation company in Surat, Gujarat.",
      telephone: b.telephone,
      email: b.email,
      priceRange: "₹₹",
      address: {
        "@type": "PostalAddress",
        streetAddress: b.streetAddress || undefined,
        addressLocality: "Surat",
        addressRegion: "Gujarat",
        postalCode: b.postalCode || undefined,
        addressCountry: "IN",
      },
      areaServed: ["Surat", "Gujarat"].map((n) => ({ "@type": "Place", name: n })),
      sameAs: b.sameAs,
      hasOfferCatalog: {
        "@type": "OfferCatalog",
        name: "Services",
        itemListElement: all.map((p) => ({
          "@type": "Offer",
          itemOffered: { "@type": "Service", name: p.serviceType, url: `${SITE}/services/${p.slug}` },
        })),
      },
    },
    { "@type": "WebSite", "@id": `${SITE}/#website`, url: `${SITE}/`, name: "CohortIX", publisher: { "@id": `${SITE}/#business` } },
  ],
};
const homeJsonLdTag = `\n  ${jsonLdTag(homeJsonLd)}`;
const homeBlocks = {
  services: renderHomeServices(all),
  footer: footerSeo,
  jsonld: homeJsonLdTag,
  closing: renderClosing(common.closing.home),
};
const nextHome = Object.keys(homeBlocks).reduce(
  (html, name) => inject(html, name, homeBlocks[name]),
  home,
);
if (nextHome !== home) {
  writeFileSync(homePath, nextHome);
  console.log("updated index.html service links");
}

// ---- sitemap (lastmod = source file mtime, not build time) --------------
const day = (d) => d.toISOString().slice(0, 10);
const contactPath = join(ROOT, "contact.html");
const urls = [
  [`${SITE}/`, statSync(homePath).mtime],
  ...(existsSync(contactPath) ? [[`${SITE}/contact`, statSync(contactPath).mtime]] : []),
  ...all.map((p) => [`${SITE}/services/${p.slug}`, p.mtime]),
  [`${SITE}/work/`, new Date(Math.max(...works.map((w) => w.mtime)))],
  ...works.map((w) => [`${SITE}/work/${w.slug}`, w.mtime]),
  ...legal.pages.map((p) => [`${SITE}/${p.slug}`, statSync(join(ROOT, `templates/legal/${p.slug}.html`)).mtime]),
];
const sitemap =
  `<?xml version="1.0" encoding="UTF-8"?>\n` +
  `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
  urls.map(([u, m]) => `  <url><loc>${u}</loc><lastmod>${day(m)}</lastmod></url>`).join("\n") +
  `\n</urlset>\n`;
writeFileSync(join(ROOT, "sitemap.xml"), sitemap);
console.log("wrote sitemap.xml");
