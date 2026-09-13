/**
 * Client Success & Revenue Impact UI Component Controller
 * Smooth minimalist counter animation.
 */
(function () {
  'use strict';

  function initRevenueCounter() {
    const wrapper = document.querySelector('.andrii_wrapper');
    const digitsEl = document.getElementById('revCountDigits');
    if (!digitsEl) return;

    let hasAnimated = false;
    let animationFrameId = null;

    function runCountUp() {
      if (hasAnimated) return;
      hasAnimated = true;

      const duration = 1200; // ms
      const startTime = performance.now();
      const finalVal = 2;

      function step(now) {
        const elapsed = now - startTime;
        const progress = Math.min(elapsed / duration, 1);

        // Exponential ease-out
        const ease = progress === 1 ? 1 : 1 - Math.pow(2, -10 * progress);
        const currentVal = ease * finalVal;

        if (progress < 1) {
          digitsEl.textContent = currentVal < 0.1 ? '0' : currentVal.toFixed(1);
          animationFrameId = requestAnimationFrame(step);
        } else {
          digitsEl.textContent = '2';
        }
      }

      cancelAnimationFrame(animationFrameId);
      animationFrameId = requestAnimationFrame(step);
    }

    const icon = document.querySelector('.andrii_icon');
    if (icon) {
      icon.addEventListener('click', function () {
        hasAnimated = false;
        setTimeout(runCountUp, 150);
      });
    }

    if (wrapper) {
      const observer = new MutationObserver(function () {
        const isVisible =
          wrapper.style.visibility === 'visible' &&
          wrapper.style.opacity !== '0';
        if (isVisible) {
          runCountUp();
        }
      });

      observer.observe(wrapper, {
        attributes: true,
        attributeFilter: ['style', 'class'],
      });

      if (
        wrapper.style.visibility === 'visible' &&
        wrapper.style.opacity !== '0'
      ) {
        setTimeout(runCountUp, 200);
      }
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initRevenueCounter);
  } else {
    initRevenueCounter();
  }
})();
