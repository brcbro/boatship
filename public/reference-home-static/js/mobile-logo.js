/* Homepage, < 992px: the big CohortIX logo starts full width under the bar and
   shrinks into the bar's logo as you scroll — the mobile take on Webflow's
   desktop-only "Logo shrinking" interaction. Styles: css/responsive.css §2b. */
(function () {
  "use strict";

  const MOBILE = window.matchMedia("(max-width: 991px)");
  const SHRINK_DISTANCE = 220; // px of scroll to go from big to docked
  const GUTTER = 16;
  const START_TOP = 76; // just under the 56px bar

  const big = document.querySelector(".nav_wrap > a.link");
  const small = document.querySelector(".logo_link.tablet .logo");
  const bar = document.querySelector(".nav_wrap .navbar");
  if (!big || !small || !bar) return;

  const root = document.documentElement;
  let ticking = false;

  function update() {
    ticking = false;
    if (!MOBILE.matches) {
      root.classList.remove("has-mobile-logo", "is-logo-docked");
      big.style.removeProperty("--logo-w");
      big.style.removeProperty("--logo-y");
      return;
    }
    const p = Math.min(Math.max(window.scrollY / SHRINK_DISTANCE, 0), 1);
    const eased = 1 - Math.pow(1 - p, 2); // settles gently into the bar
    const dock = small.getBoundingClientRect();
    // The bar slides away on scroll-down: shrink towards where its logo rests, and
    // blend in the slide so the logo rides along with the bar by the time it docks.
    const barShift = new DOMMatrixReadOnly(getComputedStyle(bar).transform).m42;
    const restTop = dock.top - barShift;
    const fullW = window.innerWidth - GUTTER * 2;

    big.style.setProperty("--logo-w", `${fullW + (dock.width - fullW) * eased}px`);
    big.style.setProperty("--logo-y", `${START_TOP + (restTop - START_TOP) * eased + barShift * eased}px`);
    root.classList.add("has-mobile-logo");
    root.classList.toggle("is-logo-docked", p >= 1);
  }

  const request = () => {
    if (!ticking) { ticking = true; requestAnimationFrame(update); }
  };

  window.addEventListener("scroll", request, { passive: true });
  window.addEventListener("resize", request);
  MOBILE.addEventListener("change", request);
  update();
})();
