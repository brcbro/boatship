(function () {
  'use strict';

  function initTestimonials() {
    const container = document.querySelector('.ti-testimonials-container');
    const cards = [
      document.querySelector('.ti-card[data-card="1"]'),
      document.querySelector('.ti-card[data-card="2"]'),
      document.querySelector('.ti-card[data-card="3"]'),
      document.querySelector('.ti-card[data-card="4"]')
    ];

    if (!container || cards.some(c => !c)) return;

    // Initial Stack Offsets (progress = 0)
    const initialConfig = [
      { rot: -3.8, y: 6 },  // Card 1 (Heart, bottom)
      { rot: -1.2, y: 2 },  // Card 2 (Spades)
      { rot: 1.2, y: 5 },   // Card 3 (Diamond)
      { rot: 0.0, y: 0 }    // Card 4 (Club, top)
    ];

    // Easing functions
    function easeOutQuad(t) {
      return t * (2 - t);
    }
    function easeInOutQuad(t) {
      return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
    }
    function clamp(val, min, max) {
      return Math.min(Math.max(val, min), max);
    }

    let ticking = false;

    function update() {
      ticking = false;

      const rect = container.getBoundingClientRect();
      const windowHeight = window.innerHeight;
      const totalScroll = container.offsetHeight - windowHeight;

      if (totalScroll <= 0) return;

      // Calculate progress between 0 and 1
      const progress = clamp(-rect.top / totalScroll, 0, 1);
      const isMobile = window.innerWidth < 768;
      const isTablet = window.innerWidth >= 768 && window.innerWidth < 1100;

      let targetX, targetScale;

      if (isMobile) {
        // Mobile layout: smooth sliding focus on each card
        targetScale = 0.85;
      } else if (isTablet) {
        const spacing = (window.innerWidth - 60) / 4.4;
        targetX = [-1.5 * spacing, -0.5 * spacing, 0.5 * spacing, 1.5 * spacing];
        targetScale = clamp((window.innerWidth - 60) / 1400, 0.65, 0.76);
      } else {
        // Desktop standard (matching TechInfinity exactly: -420, -140, +140, +420)
        targetX = [-420, -140, 140, 420];
        targetScale = 0.8;
      }

      // Flip timing windows for each card [start, end]
      const flipWindows = [
        [0.64, 0.90], // Card 1
        [0.57, 0.83], // Card 2
        [0.50, 0.76], // Card 3
        [0.43, 0.69]  // Card 4
      ];

      cards.forEach((card, index) => {
        const cfg = initialConfig[index];

        if (isMobile) {
          // Mobile: As user scrolls, the deck spreads slightly and cards flip in sequence
          const spreadP = easeOutQuad(clamp((progress - 0.05) / 0.45, 0, 1));
          
          // Slight spread on mobile
          const mobSpreadX = [-45, -15, 15, 45][index] * spreadP;
          const currentRot = cfg.rot * (1 - spreadP);
          const currentY = cfg.y * (1 - spreadP);

          // Staggered flip
          const [fStart, fEnd] = flipWindows[index];
          const flipP = easeInOutQuad(clamp((progress - fStart) / (fEnd - fStart), 0, 1));
          const flipAngle = flipP * 180;

          // Highlight current active card on mobile
          const zIndex = flipP > 0.5 ? 10 + index : (index + 1);

          card.style.zIndex = zIndex;
          card.style.transform = `perspective(1200px) translateX(${mobSpreadX}px) translateY(${currentY}px) scale(${targetScale}) rotate(${currentRot}deg) rotateY(${flipAngle}deg)`;

        } else {
          // Desktop / Tablet: Spread horizontally and flip 180deg
          const spreadP = easeOutQuad(clamp((progress - 0.04) / 0.52, 0, 1));
          const currentX = (targetX[index] * spreadP);
          const currentRot = cfg.rot * (1 - spreadP);
          const currentY = cfg.y * (1 - spreadP);
          const currentScale = 1.0 - (1.0 - targetScale) * spreadP;

          // Flip
          const [fStart, fEnd] = flipWindows[index];
          const flipP = easeInOutQuad(clamp((progress - fStart) / (fEnd - fStart), 0, 1));
          const flipAngle = flipP * 180;

          // Z-index management: during stack, Card 4 is on top (4 > 3 > 2 > 1).
          // Once fanned out, cards have equal level.
          const zIndex = index + 1;

          card.style.zIndex = zIndex;
          card.style.transform = `perspective(1200px) translateX(${currentX.toFixed(2)}px) translateY(${currentY.toFixed(2)}px) scale(${currentScale.toFixed(3)}) rotate(${currentRot.toFixed(2)}deg) rotateY(${flipAngle.toFixed(2)}deg)`;
        }
      });
    }

    function onScroll() {
      if (!ticking) {
        window.requestAnimationFrame(update);
        ticking = true;
      }
    }

    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });

    // Initial positioning
    update();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initTestimonials);
  } else {
    initTestimonials();
  }
})();
