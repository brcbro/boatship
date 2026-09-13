"use client";

import { useCallback } from "react";

const replacements: Array<[string, string]> = [
  ["CohortIX", "Boatship"], ["COHORTIX", "BOATSHIP"],
  ["Tech that Sells. & Design that Sticks.", "Client work, kept moving."], ["Tech that sells. & Design that Sticks", "Client work, kept moving."],
  ["India’s software & digital studio for brands ready to scale and lead", "The client workspace for teams ready to deliver with direction"], ["India's software & digital studio for brands ready to scale and lead", "The client workspace for teams ready to deliver with direction"],
  ["Software", "Onboarding"], ["SaaS", "Delivery"], ["UI/UX", "Clients"], ["Full Scale", "Clarity"],
  ["Your digital product isn’t just an interface.", "Your client experience is not just a portal."], ["It’s the engine of your business growth.", "It is the confidence behind every project."],
  ["One partner → Full scale.", "One workspace → Full context."], ["The road can get bumpy. We keep you rolling regardless.", "The work can get complex. We keep everyone on the same course."],
  ["Discovery & Architecture", "Onboard with intent"], ["UI/UX & Prototyping", "Plan every milestone"], ["Full-Stack Engineering", "Keep work in view"], ["Deployment & Scale", "Handover with clarity"],
  ["Book a call", "Enter workspace"], ["Open for work", "Now boarding"],
];

export function ReferenceHomepage() {
  const personalizeReference = useCallback((frame: HTMLIFrameElement) => {
    const document = frame.contentDocument;
    if (!document) return;
    const applyBrand = () => {
      document.title = "Boatship | Client Onboarding Workspace";
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      const textNodes: Text[] = [];
      while (walker.nextNode()) textNodes.push(walker.currentNode as Text);
      textNodes.forEach((node) => { let text = node.nodeValue ?? ""; replacements.forEach(([source, replacement]) => { text = text.replaceAll(source, replacement); }); node.nodeValue = text; });
      const setText = (selector: string, text: string) => document.querySelectorAll<HTMLElement>(selector).forEach((element) => { element.textContent = text; });
      setText(".h1", "The client workspace for teams ready to deliver with direction");
      document.querySelectorAll<HTMLElement>(".h2.about").forEach((heading) => {
        heading.innerHTML = "Client work is more than a checklist.<br><span class=\"italic-text\">It is every moment clients trust you with.</span>";
      });
      setText(".about_text._03", "Boatship brings forms, tasks, files, approvals, and messages together so client work stays calm, clear, and moving.");
      document.querySelectorAll<HTMLElement>(".about_text._02").forEach((copy) => {
        copy.innerHTML = "Start with one shared workspace <span class=\"italic-text\">→ then give every client a clear route from onboarding to handover.</span>";
      });
      document.querySelectorAll<HTMLImageElement>(".about_image").forEach((image) => {
        image.src = "/brand/boatship-logo-black.png";
        image.alt = "Boatship";
        image.style.objectFit = "contain";
      });
      setText(".paragraph.process", "Everything clients need to move work forward. All in one calm place.");
      setText("#process .title_text", "Boatship features");
      setText(".logo_text", "Client work, kept moving.");
      setText(".nav_link.mail, .footer_link.mail", "hello@boatship.co");
      document.querySelectorAll<HTMLAnchorElement>(".nav_link.mail, .footer_link.mail").forEach((link) => { link.href = "mailto:hello@boatship.co"; });
      document.querySelectorAll<HTMLElement>(".navlinks_flex").forEach((navigation) => {
        navigation.innerHTML = "<a href=\"/login\" class=\"nav_link\">Enter Workspace</a>";
      });
      document.querySelectorAll<HTMLElement>(".nav_link.mail, .footer_link.mail").forEach((link) => { link.style.display = "none"; });
      const features = [
        ["Forms &", "Onboarding", "Give every client a clear first step with guided forms, welcome tasks, and the files you need from day one."],
        ["Projects &", "Tasks", "Turn the scope into an organised plan with owners, due dates, and progress that everyone can follow."],
        ["Documents &", "Approvals", "Keep project files together and collect sign-off in the workspace instead of chasing it across email."],
        ["Client", "Messages", "Share updates, answer questions, and keep every conversation connected to the work it moves forward."],
      ];
      document.querySelectorAll<HTMLElement>(".process_card").forEach((card, index) => {
        const feature = features[index];
        if (!feature) return;
        const title = card.querySelector<HTMLElement>(".h3.process");
        const description = card.querySelector<HTMLElement>(".paragraph.balanced");
        if (title) title.innerHTML = `${feature[0]}<br><span class="italic">${feature[1]}</span>`;
        if (description) description.textContent = feature[2];
      });
      const featureCards: Record<string, [string, string, string, string, string]> = {
        "1": ["Guided onboarding", "Welcome every client with forms, files, and the next steps already mapped out.", "01", "A clear start for every project", "Client onboarding"],
        "2": ["Shared project plan", "Give clients and your team one live view of tasks, milestones, owners, and due dates.", "ONE VIEW", "Progress everyone can follow", "Projects & tasks"],
        "3": ["Approvals that move work", "Share documents, collect decisions, and keep sign-off connected to the exact work it unlocks.", "NO CHASING", "Reviews stay in one place", "Documents & approvals"],
        "4": ["Messages in context", "Keep questions, updates, and decisions beside the project—not scattered across inboxes.", "FULL CONTEXT", "Conversations tied to the work", "Client messages"],
      };
      document.querySelectorAll<HTMLElement>(".ti-testimonials-title").forEach((title) => { title.innerHTML = "Client work. <span class=\"ti-title-italic\">Clear delivery.</span>"; });
      document.querySelectorAll<HTMLElement>(".ti-card").forEach((card) => {
        const feature = featureCards[card.dataset.card ?? ""];
        if (!feature) return;
        const quote = card.querySelector<HTMLElement>(".ti-quote-text");
        const value = card.querySelector<HTMLElement>(".ti-stat-value");
        const label = card.querySelector<HTMLElement>(".ti-stat-label");
        const author = card.querySelector<HTMLElement>(".ti-author-name");
        if (quote) quote.innerHTML = `<strong>${feature[0]}:</strong> ${feature[1]}`;
        if (value) value.textContent = feature[2];
        if (label) label.textContent = feature[3];
        if (author) author.textContent = feature[4];
      });
      document.querySelectorAll<SVGElement>(".ti-brand-logo, .ti-back-logo").forEach((logo) => {
        const mark = document.createElement("img");
        mark.src = "/brand/boatship-b-white.png";
        mark.alt = "Boatship";
        mark.className = `${logo.getAttribute("class") ?? ""} ti-boatship-b`;
        logo.replaceWith(mark);
      });
      document.querySelectorAll<HTMLElement>(".h2.cta").forEach((heading) => {
        heading.innerHTML = "Ready to give your<br><span class=\"italic-text\">clients a clearer course?</span>";
      });
      document.querySelectorAll<HTMLElement>(".paragraph.cta").forEach((copy) => {
        copy.innerHTML = "Bring every brief, task, file, and approval into one place. <span class=\"italic\">One workspace. No chasing.</span>";
      });
      document.querySelectorAll<HTMLElement>(".svc-close, .svc-footer, .footer_logo_wrap, .footer_shadow").forEach((element) => { element.style.display = "none"; });
      document.querySelectorAll<HTMLElement>(".footer_navigation_wrap").forEach((footerNavigation) => {
        [...footerNavigation.children].forEach((child) => {
          if (child.id !== "timezone") child.remove();
        });
      });
      if (document.getElementById("boatship-brand-overrides")) return;
      const style = document.createElement("style"); style.id = "boatship-brand-overrides";
      style.textContent = ".loader_logo{background:url('/brand/boatship-logo-white.png') center/contain no-repeat!important}.loader_logo svg{opacity:0!important}.logo:not(.light){background:url('/brand/boatship-logo-black.png') center/contain no-repeat!important}.logo:not(.light) svg{opacity:0!important}.logo.light{background:url('/brand/boatship-logo-white.png') center/contain no-repeat!important}.logo.light svg{opacity:0!important}.section.dark.video,#portfolio,#our_work{display:none!important}.ti-card-front .ti-boatship-b{filter:brightness(0);object-fit:contain}.ti-card-back .ti-boatship-b{filter:none;object-fit:contain}.ti-testimonials-title{color:#147bd1!important}.ti-title-italic{color:#e42d25!important}.footer{height:150px!important;max-height:none!important;min-height:150px!important}.footer_container{align-items:center!important;display:flex!important;height:150px!important;justify-content:center!important;padding:0!important}.footer_navigation_wrap{display:block!important}.footer_navigation_wrap #timezone{color:#edf4f5!important;font-family:monospace!important;font-size:13px!important;text-align:center!important}.footer_logo_wrap,.svc-close,.svc-footer,.footer_shadow{display:none!important}";
      document.head.appendChild(style);
    };
    applyBrand();
    window.setTimeout(applyBrand, 900);
    window.setTimeout(applyBrand, 3600);
  }, []);
  return <iframe title="Boatship homepage" src="/reference-home-static/index.html" className="reference-home" onLoad={(event) => personalizeReference(event.currentTarget)} />;
}
