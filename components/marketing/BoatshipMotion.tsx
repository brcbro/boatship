"use client";
import { useLayoutEffect } from "react";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
gsap.registerPlugin(ScrollTrigger);
export function BoatshipMotion() {
  useLayoutEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const context = gsap.context(() => {
      gsap.timeline({ defaults: { ease: "power4.out" }, delay: 1.4 }).from("[data-brand-mark]", { clipPath: "inset(0 100% 0 0)", duration: .9 }).from("[data-hero-copy]", { autoAlpha: 0, y: 40, duration: .7 }, "-=.34").from("[data-hero-meta]", { autoAlpha: 0, y: 16, duration: .45 }, "-=.38").from("[data-portal]", { autoAlpha: 0, rotateX: 11, transformPerspective: 900, y: 45, duration: .85 }, "-=.28");
      gsap.utils.toArray<HTMLElement>("[data-reveal]").forEach((element) => gsap.from(element, { autoAlpha: 0, filter: "blur(9px)", y: 24, duration: .7, ease: "power3.out", scrollTrigger: { trigger: element, start: "top 83%", once: true } }));
      const process = document.querySelector<HTMLElement>("[data-process]"); const covers = gsap.utils.toArray<HTMLElement>("[data-process-cover]");
      if (process && covers.length) { const media = gsap.matchMedia(); media.add("(min-width: 761px)", () => gsap.timeline({ scrollTrigger: { trigger: process, start: "top top", end: "+=1200", pin: true, scrub: .65, anticipatePin: 1 } }).to(covers, { scaleY: 1, stagger: .22, duration: 1.1, ease: "none" })); }
      const showcase = document.querySelector<HTMLElement>("[data-showcase]"); const rows = gsap.utils.toArray<HTMLElement>("[data-showcase-row]"); if (showcase && rows.length) gsap.from(rows, { autoAlpha: 0, x: -28, duration: .55, stagger: .1, ease: "power3.out", scrollTrigger: { trigger: showcase, start: "top 72%", once: true } });
      gsap.from("[data-closing]", { clipPath: "inset(0 0 100% 0)", duration: .85, ease: "power4.out", scrollTrigger: { trigger: "[data-closing]", start: "top 76%", once: true } });
    }); return () => context.revert();
  }, []); return null;
}
