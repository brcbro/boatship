document.addEventListener("DOMContentLoaded", function () {
  if (
    typeof gsap === "undefined" ||
    typeof ScrollTrigger === "undefined" ||
    typeof SplitText === "undefined"
  ) return;

  gsap.registerPlugin(ScrollTrigger, SplitText);

  const MOBILE_BP = 768;
  const DESKTOP_BP = 992;
  const DEFAULT_OFFSET = 0.2;

  const jumpState = {
    triggerId: null,
    label: null,
    until: 0
  };

  function setJumpLock(triggerId, label, duration) {
    jumpState.triggerId = triggerId || null;
    jumpState.label = label || null;
    jumpState.until = Date.now() + (duration || 1200);
  }

  function clearJumpLockLater(delay) {
    setTimeout(function () {
      if (Date.now() >= jumpState.until) {
        jumpState.triggerId = null;
        jumpState.label = null;
        jumpState.until = 0;
      }
    }, delay || 1300);
  }

  function setNavLight(isLight) {
    if (typeof $ !== "undefined") {
      $(".logo, .nav_link").toggleClass("light", !!isLight);
    } else {
      document.querySelectorAll(".logo, .nav_link").forEach(function (el) {
        el.classList.toggle("light", !!isLight);
      });
    }
  }

  /* Blur reveal */
  gsap.utils.toArray('[data-reveal="blur"]').forEach(function (text) {
    if (
      text.matches("a") ||
      text.closest("a") ||
      text.querySelector('a[href^="#"]')
    ) {
      return;
    }

    SplitText.create(text, {
      type: "lines",
      linesClass: "about-line",
      autoSplit: true,
      onSplit(self) {
        return gsap.fromTo(
          self.lines,
          {
            opacity: 0,
            filter: "blur(10px)",
            y: 15
          },
          {
            opacity: 1,
            filter: "blur(0px)",
            y: 0,
            duration: 0.4,
            ease: "power1.out",
            stagger: 0.12,
            overwrite: true,
            scrollTrigger: {
              trigger: text,
              start: "top 75%",
              toggleActions: "play none none none",
              jumpIgnore: true
            }
          }
        );
      }
    });
  });

/* Portfolio 3-item window strictly scroll-driven image update */
gsap.registerPlugin(ScrollTrigger);
ScrollTrigger.config({ limitCallbacks: true, ignoreMobileResize: true });

gsap.matchMedia().add("(min-width: 992px)", function () {
  const section = document.querySelector(".sticky_wrap");
  const pinEl = document.querySelector(".case_wrapper");
  const track = pinEl ? pinEl.querySelector(".work_list_track") : null;
  if (!section || !pinEl || !track) return;

  const items = gsap.utils.toArray(".work_item", track);
  const masks = gsap.utils.toArray(".slide_mask", pinEl);
  const images = masks.map(function (m) {
    return m.querySelector("img");
  });

  if (!items.length || !masks.length || images.some(img => !img)) return;

  const ITEM_HEIGHT = 82;
  const TOTAL_ITEMS = items.length;
  const TOTAL_STEPS = TOTAL_ITEMS - 1; // 15 transitions for 16 items

  const SCROLL_PER_SLIDE = 0.75;
  const SCRUB = 0.8;
  const TRANSITION = 0.8;
  const FADE = 0.35;
  const DIM = 0.28;
  const ZOOM_IN = 1.1;
  const ZOOM_OUT = 1.2;
  const SNAP_THRESHOLD = 0.2;

  const HIDDEN = "polygon(100% 100%, 100% 100%, 100% 100%, 100% 100%)";
  const FULL = "polygon(0% 0%, 100% 0%, 100% 101%, 0% 101%)";

  const STEP = 1;

  // 1. Initial State: Track at 0, Item 0 active (1.0), Items 1 & 2 dim (0.28), rest hidden (0)
  gsap.set(track, { y: 0, force3D: true });

  items.forEach(function (it, idx) {
    if (idx === 0) {
      gsap.set(it, { opacity: 1 });
      it.classList.add("is-active");
    } else if (idx === 1 || idx === 2) {
      gsap.set(it, { opacity: DIM });
      it.classList.remove("is-active");
    } else {
      gsap.set(it, { opacity: 0 });
      it.classList.remove("is-active");
    }
  });

  // Masks and images initial setup
  gsap.set(masks, {
    clipPath: HIDDEN,
    willChange: "clip-path"
  });

  gsap.set(images, {
    scale: ZOOM_IN,
    transformOrigin: "50% 50%",
    force3D: true,
    willChange: "transform"
  });

  // Slide 0 starts revealed
  gsap.set(masks[0], { clipPath: FULL });
  gsap.set(images[0], { scale: 1 });

  // 2. Build Master Scroll Timeline: Strictly driven by scroll progress
  const tl = gsap.timeline({
    defaults: {
      duration: TRANSITION,
      ease: "power2.inOut"
    }
  });

  tl.addLabel("s0", 0);

  for (let i = 1; i < TOTAL_ITEMS; i++) {
    const at = (i - 1) * STEP;

    // A. Move track upwards by 1 item height (82px)
    tl.to(track, {
      y: -i * ITEM_HEIGHT,
      duration: STEP,
      ease: "power1.inOut"
    }, at);

    // B. Vanish effect: Top item (i - 1) moves out and fades to 0
    tl.to(items[i - 1], {
      opacity: 0,
      duration: FADE,
      ease: "power1.in"
    }, at);

    // C. Activate effect: Incoming item (i) enters top focus slot and becomes active (1.0)
    tl.to(items[i], {
      opacity: 1,
      duration: FADE,
      ease: "none"
    }, at + 0.1);

    // D. Item i + 1 stays/sets to DIM (0.28) in middle slot
    if (i + 1 < TOTAL_ITEMS) {
      tl.to(items[i + 1], {
        opacity: DIM,
        duration: FADE,
        ease: "none"
      }, at);
    }

    // E. Entrance effect: Item i + 2 enters from bottom slot (if it exists)
    if (i + 2 < TOTAL_ITEMS) {
      tl.to(items[i + 2], {
        opacity: DIM,
        duration: FADE,
        ease: "none"
      }, at);
    }

    // F. Image update: Mask i reveals with original diagonal clipPath wipe & scale
    tl.to(masks[i], {
      clipPath: FULL,
      duration: TRANSITION,
      ease: "power2.inOut"
    }, at);

    tl.to(images[i], {
      scale: 1,
      duration: TRANSITION,
      ease: "none"
    }, at);

    // G. Previous image zooms out
    tl.to(images[i - 1], {
      scale: ZOOM_OUT,
      duration: TRANSITION,
      ease: "none"
    }, at);

    tl.addLabel("s" + i, i * STEP);
  }

  const END = TOTAL_STEPS * STEP;
  tl.to({}, { duration: 0.01 }, END);

  const dur = tl.duration();
  const labelsAsc = Array.from(
    new Set(
      Object.values(tl.labels).map(function (t) {
        return t / dur;
      })
    )
  ).sort(function (a, b) {
    return a - b;
  });

  // 3. Pinned ScrollTrigger: Strictly ties image and list updates to scroll position
  ScrollTrigger.create({
    id: "portfolio-scroll",
    animation: tl,
    trigger: section,
    start: "top top",
    end: function () {
      return "+=" + Math.round(TOTAL_STEPS * window.innerHeight * SCROLL_PER_SLIDE);
    },
    pin: pinEl,
    pinSpacing: true,
    anticipatePin: 1,
    invalidateOnRefresh: true,
    scrub: SCRUB,
    snap: {
      snapTo: function (value, self) {
        const rawProgress = gsap.utils.clamp(
          0,
          1,
          (self.scroll() - self.start) / (self.end - self.start)
        );

        let lower = labelsAsc[0];
        let upper = labelsAsc[labelsAsc.length - 1];

        for (let i = 0; i < labelsAsc.length - 1; i++) {
          if (rawProgress >= labelsAsc[i] && rawProgress <= labelsAsc[i + 1]) {
            lower = labelsAsc[i];
            upper = labelsAsc[i + 1];
            break;
          }
        }

        if (lower === upper) return lower;

        const localProgress = (rawProgress - lower) / (upper - lower);

        if (self.direction > 0) {
          return localProgress >= SNAP_THRESHOLD ? upper : lower;
        }

        return localProgress <= 1 - SNAP_THRESHOLD ? lower : upper;
      },
      duration: { min: 0.25, max: 0.45 },
      delay: 0.05,
      ease: "power1.inOut",
      inertia: false
    },
    onUpdate: function (self) {
      // Active state tracking: update active class on items purely from scroll progress
      const activeIdx = Math.min(TOTAL_STEPS, Math.round(self.progress * TOTAL_STEPS));
      items.forEach(function (item, idx) {
        if (idx === activeIdx) {
          item.classList.add("is-active");
        } else {
          item.classList.remove("is-active");
        }
      });
    }
  });

  // 4. Click handling: Clicking an item opens the project external link, NEVER triggers an image change
  items.forEach(function (item) {
    item.addEventListener("click", function (e) {
      // No image swap or animation triggered
      const href = item.getAttribute("data-href");
      if (href) {
        window.open(href, "_blank", "noopener,noreferrer");
      }
    });
  });

  // NOTE: Hover effects (mouseenter/mouseleave) are completely removed.
  // Hovering over list items does absolutely nothing to the right-side image.
});
  
  /* Jump to section / label */
  document.querySelectorAll('a[href^="#"]').forEach(function (link) {
    link.addEventListener(
      "click",
      function (e) {
        const href = this.getAttribute("href");
        if (!href || href === "#") return;

        const targetId = href.slice(1);
        const target = document.getElementById(targetId);
        if (!target) return;

        e.preventDefault();

        const isMobile = window.innerWidth < DESKTOP_BP;
        if (!isMobile) e.stopImmediatePropagation();

        const doJump = function () {
          document.documentElement.style.scrollBehavior = "auto";
          document.body.style.scrollBehavior = "auto";

          document.body.getBoundingClientRect();

          let destination;
          let st = null;

          if (typeof ScrollTrigger !== "undefined") {
            ScrollTrigger.refresh(true);

            const stId = target.dataset.scrollTriggerId;
            if (stId) {
              st = ScrollTrigger.getById(stId) || null;
            }

            if (!st) {
              const candidates = ScrollTrigger.getAll().filter(function (instance) {
                if (!instance || !instance.trigger) return false;
                if (instance.vars && instance.vars.jumpIgnore) return false;

                return (
                  target === instance.trigger ||
                  target.contains(instance.trigger) ||
                  instance.trigger.contains(target)
                );
              });

              st =
                candidates.find(function (instance) {
                  return instance.trigger === target;
                }) ||
                candidates.sort(function (a, b) {
                  const aLen = Math.abs((a.end || 0) - (a.start || 0));
                  const bLen = Math.abs((b.end || 0) - (b.start || 0));
                  return bLen - aLen;
                })[0] ||
                null;
            }
          }

          if (st) {
            const anim = st.animation;
            const namedLabel = target.dataset.scrollLabel;
            const stId = (st.vars && st.vars.id) ? st.vars.id : null;

            if (
              namedLabel &&
              anim &&
              anim.labels &&
              anim.labels[namedLabel] !== undefined &&
              typeof anim.duration === "function" &&
              anim.duration() > 0
            ) {
              const fraction = anim.labels[namedLabel] / anim.duration();

              if (stId) setJumpLock(stId, namedLabel, 1200);

              destination = st.start + (st.end - st.start) * fraction;

              if (namedLabel === "s0") {
                destination += 1;
              }
            } else {
              const pct = parseFloat(target.dataset.scrollOffset ?? DEFAULT_OFFSET);
              destination = st.start + (st.end - st.start) * pct;
            }
          } else {
            const pct = parseFloat(target.dataset.scrollOffset ?? DEFAULT_OFFSET);
            const scrollableHeight = Math.max(0, target.offsetHeight - window.innerHeight);

            destination =
              target.getBoundingClientRect().top +
              window.scrollY +
              scrollableHeight * pct;
          }

          window.scrollTo({
            top: Math.max(0, destination),
            behavior: "auto"
          });

          requestAnimationFrame(function () {
            requestAnimationFrame(function () {
              document.documentElement.style.scrollBehavior = "";
              document.body.style.scrollBehavior = "";

              if (typeof ScrollTrigger !== "undefined") {
                ScrollTrigger.refresh(true);
                ScrollTrigger.update();
              }

              if (window.innerWidth >= DESKTOP_BP && window.updateNavColorFromSections) {
                window.updateNavColorFromSections();
              }

              clearJumpLockLater(1300);
            });
          });
        };

        if (isMobile) {
          setTimeout(doJump, 700);
        } else {
          doJump();
        }
      },
      true
    );
  });

  /* Global refresh */
  window.addEventListener("load", function () {
    if (window.innerWidth >= DESKTOP_BP && window.updateNavColorFromSections) {
      window.updateNavColorFromSections();
    }

    ScrollTrigger.refresh(true);
  });

  let resizeTimer;

  window.addEventListener("resize", function () {
    clearTimeout(resizeTimer);

    resizeTimer = setTimeout(function () {
      if (window.innerWidth >= DESKTOP_BP) {
        unlockScroll();
        window.updateNavColorFromSections();
      }

      ScrollTrigger.refresh(true);
    }, 200);
  });

  /* Lock scroll when mobile menu is open — tablet and below only */
  const menuOpen = document.querySelector('.menu_button.open');
  const menuClose = document.querySelector('.menu_button.close');

  function lockScroll() {
    if (window.innerWidth < DESKTOP_BP) {
      document.body.style.overflow = 'hidden';
      document.querySelector('.navbar').style.zIndex = '9000000';
    }
  }

  function unlockScroll() {
    document.body.style.overflow = '';
    document.querySelector('.navbar').style.zIndex = '800';
  }

  if (menuOpen) {
    menuOpen.addEventListener('click', lockScroll);
  }

  if (menuClose) {
    menuClose.addEventListener('click', unlockScroll);
  }

  document.querySelectorAll('.nav_link').forEach(function (link) {
    link.addEventListener('click', unlockScroll);
  });

});