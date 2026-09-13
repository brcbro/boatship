document.addEventListener('DOMContentLoaded', function () {
  if (typeof gsap === 'undefined' || typeof MorphSVGPlugin === 'undefined') return;

  gsap.registerPlugin(MorphSVGPlugin);

  const CENTER_X = 706;
  const CENTER_Y = 139;

  function buildTimeline() {
    const tl = gsap.timeline({
      onComplete: function () {
        gsap.set('#shape1', {
          rotation: 0,
          svgOrigin: CENTER_X + ' ' + CENTER_Y
        });

        buildTimeline();
      }
    });

    const step = function (shape, rotation) {
      return {
        duration: 1,
        morphSVG: { shape: shape, shapeIndex: 'auto' },
        rotation: rotation,
        svgOrigin: CENTER_X + ' ' + CENTER_Y,
        ease: 'power2.inOut'
      };
    };

    tl.to('#shape1', step('#shape2', 60))
      .to('#shape1', step('#shape3', 120))
      .to('#shape1', step('#shape4', 180))
      .to('#shape1', step('#shape5', 240))
      .to('#shape1', step('#shape6', 300))
      .to('#shape1', step('#shape7', 360))
      .to('#shape1', step('#shape1', 450));

    return tl;
  }

  if (document.querySelector('#shape1')) {
    buildTimeline();
  }
});