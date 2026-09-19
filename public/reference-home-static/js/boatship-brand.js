(function () {
  "use strict";

  var replacements = [
    ["CohortIX", "Boatship"], ["COHORTIX", "BOATSHIP"],
    ["Tech that Sells. & Design that Sticks.", "Client work, kept moving."],
    ["Tech that sells. & Design that Sticks", "Client work, kept moving."],
    ["India’s software & digital studio for brands ready to scale and lead", "The client workspace for teams ready to deliver with direction"],
    ["India's software & digital studio for brands ready to scale and lead", "The client workspace for teams ready to deliver with direction"],
    ["Software", "Onboarding"], ["SaaS", "Delivery"], ["UI/UX", "Clients"], ["Full Scale", "Clarity"],
    ["Your digital product isn’t just an interface.", "Your client experience is not just a portal."],
    ["It’s the engine of your business growth.", "It is the confidence behind every project."],
    ["One partner → Full scale.", "One workspace → Full context."],
    ["The road can get bumpy. We keep you rolling regardless.", "The work can get complex. We keep everyone on the same course."],
    ["Discovery & Architecture", "Onboard with intent"], ["UI/UX & Prototyping", "Plan every milestone"],
    ["Full-Stack Engineering", "Keep work in view"], ["Deployment & Scale", "Handover with clarity"],
    ["Book a call", "Enter workspace"], ["Open for work", "Now boarding"]
  ];

  function setText(selector, text) {
    document.querySelectorAll(selector).forEach(function (element) {
      element.textContent = text;
    });
  }

  function applyBrand() {
    document.title = "Boatship | Client Onboarding Workspace";
    document.documentElement.classList.add("boatship-home");

    var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    var nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    nodes.forEach(function (node) {
      var text = node.nodeValue || "";
      replacements.forEach(function (replacement) {
        text = text.replaceAll(replacement[0], replacement[1]);
      });
      node.nodeValue = text;
    });

    setText(".h1", "The client workspace for teams ready to deliver with direction");
    setText(".about_text._03", "Boatship brings forms, tasks, files, approvals, and messages together so client work stays calm, clear, and moving.");
    setText(".paragraph.process", "Everything clients need to move work forward. All in one calm place.");
    setText("#process .title_text", "Boatship features");
    setText(".logo_text", "Client work, kept moving.");

    document.querySelectorAll(".h2.about").forEach(function (heading) {
      heading.innerHTML = 'Client work is more than a checklist.<br><span class="italic-text">It is every moment clients trust you with.</span>';
    });
    document.querySelectorAll(".about_text._02").forEach(function (copy) {
      copy.innerHTML = 'Start with one shared workspace <span class="italic-text">→ then give every client a clear route from onboarding to handover.</span>';
    });
    document.querySelectorAll(".about_image").forEach(function (image) {
      image.src = "/brand/boatship-logo-black.png";
      image.alt = "Boatship";
      image.style.objectFit = "contain";
    });

    document.querySelectorAll(".nav_link.mail, .footer_link.mail").forEach(function (link) {
      link.textContent = "hello@boatship.co";
      link.href = "mailto:hello@boatship.co";
      link.style.display = "none";
    });
    document.querySelectorAll(".navlinks_flex").forEach(function (navigation) {
      navigation.innerHTML = '<a href="/login" target="_top" class="nav_link">Enter Workspace</a>';
    });
    document.querySelectorAll('a[href="/login"]').forEach(function (link) {
      link.target = "_top";
    });

    var features = [
      ["Forms &", "Onboarding", "Give every client a clear first step with guided forms, welcome tasks, and the files you need from day one."],
      ["Projects &", "Tasks", "Turn the scope into an organised plan with owners, due dates, and progress that everyone can follow."],
      ["Documents &", "Approvals", "Keep project files together and collect sign-off in the workspace instead of chasing it across email."],
      ["Client", "Messages", "Share updates, answer questions, and keep every conversation connected to the work it moves forward."]
    ];
    document.querySelectorAll(".process_card").forEach(function (card, index) {
      var feature = features[index];
      if (!feature) return;
      var title = card.querySelector(".h3.process");
      var description = card.querySelector(".paragraph.balanced");
      if (title) title.innerHTML = feature[0] + '<br><span class="italic">' + feature[1] + "</span>";
      if (description) description.textContent = feature[2];
    });

    var featureCards = {
      "1": ["Guided onboarding", "Welcome every client with forms, files, and the next steps already mapped out.", "01", "A clear start for every project", "Client onboarding"],
      "2": ["Shared project plan", "Give clients and your team one live view of tasks, milestones, owners, and due dates.", "ONE VIEW", "Progress everyone can follow", "Projects & tasks"],
      "3": ["Approvals that move work", "Share documents, collect decisions, and keep sign-off connected to the exact work it unlocks.", "NO CHASING", "Reviews stay in one place", "Documents & approvals"],
      "4": ["Messages in context", "Keep questions, updates, and decisions beside the project—not scattered across inboxes.", "FULL CONTEXT", "Conversations tied to the work", "Client messages"]
    };
    document.querySelectorAll(".ti-testimonials-title").forEach(function (title) {
      title.innerHTML = 'Client work. <span class="ti-title-italic">Clear delivery.</span>';
    });
    document.querySelectorAll(".ti-card").forEach(function (card) {
      var feature = featureCards[card.dataset.card || ""];
      if (!feature) return;
      var quote = card.querySelector(".ti-quote-text");
      var value = card.querySelector(".ti-stat-value");
      var label = card.querySelector(".ti-stat-label");
      var author = card.querySelector(".ti-author-name");
      if (quote) quote.innerHTML = "<strong>" + feature[0] + ":</strong> " + feature[1];
      if (value) value.textContent = feature[2];
      if (label) label.textContent = feature[3];
      if (author) author.textContent = feature[4];
    });
    document.querySelectorAll(".ti-brand-logo, .ti-back-logo").forEach(function (logo) {
      var mark = document.createElement("img");
      mark.src = "/brand/boatship-b-white.png";
      mark.alt = "Boatship";
      mark.className = (logo.getAttribute("class") || "") + " ti-boatship-b";
      logo.replaceWith(mark);
    });

    document.querySelectorAll(".h2.cta").forEach(function (heading) {
      heading.innerHTML = 'Ready to give your<br><span class="italic-text">clients a clearer course?</span>';
    });
    document.querySelectorAll(".paragraph.cta").forEach(function (copy) {
      copy.innerHTML = 'Bring every brief, task, file, and approval into one place. <span class="italic">One workspace. No chasing.</span>';
    });
    document.querySelectorAll(".svc-close, .svc-footer, .footer_logo_wrap, .footer_shadow").forEach(function (element) {
      element.style.display = "none";
    });
    document.querySelectorAll(".footer_navigation_wrap").forEach(function (navigation) {
      Array.from(navigation.children).forEach(function (child) {
        if (child.id !== "timezone") child.remove();
      });
    });
  }

  applyBrand();
})();
