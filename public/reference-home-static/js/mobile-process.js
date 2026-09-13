/* Homepage, < 768px: process cards. Webflow slides .cards_wrap continuously with
   scroll, so no card ever rests centered. Here each card holds dead center for a
   stretch of scroll, then glides to the next. Styles: css/responsive.css §4. */
(function () {
  "use strict";

  const MOBILE = window.matchMedia("(max-width: 767px)");
  const HOLD = 0.35; // share of each card's scroll spent standing still (split before/after the glide)

  const section = document.querySelector(".process_long_wrap");
  const track = document.querySelector(".cards_wrap");
  const cards = track ? [...track.querySelectorAll(".process_card")] : [];
  if (!section || cards.length < 2) return;

  const clamp = (v) => Math.min(Math.max(v, 0), 1);
  const smooth = (t) => t * t * (3 - 2 * t);
  let ticking = false;

  function update() {
    ticking = false;
    if (!MOBILE.matches) return track.style.removeProperty("--proc-x");

    const range = section.offsetHeight - window.innerHeight;
    const progress = clamp((window.scrollY - (section.getBoundingClientRect().top + window.scrollY)) / range);
    const t = progress * (cards.length - 1);
    const i = Math.min(Math.floor(t), cards.length - 2);
    const glide = smooth(clamp((t - i - HOLD / 2) / (1 - HOLD)));

    // offsets measured from the DOM, so gap/padding changes in CSS need no JS edits
    const offset = (n) => cards[n].offsetLeft - cards[0].offsetLeft;
    track.style.setProperty("--proc-x", `${-(offset(i) + (offset(i + 1) - offset(i)) * glide)}px`);
  }

  const request = () => {
    if (!ticking) { ticking = true; requestAnimationFrame(update); }
  };

  window.addEventListener("scroll", request, { passive: true });
  window.addEventListener("resize", request);
  MOBILE.addEventListener("change", request);
  update();
})();
