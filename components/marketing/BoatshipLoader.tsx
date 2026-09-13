"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import styles from "@/app/home.module.css";

export function BoatshipLoader() {
  const [isLeaving, setIsLeaving] = useState(false);
  const [isComplete, setIsComplete] = useState(false);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      const completeTimer = window.setTimeout(() => setIsComplete(true), 0);
      return () => window.clearTimeout(completeTimer);
    }

    const progressTimer = window.setInterval(() => {
      setProgress((value) => Math.min(100, value + 4));
    }, 85);
    const leaveTimer = window.setTimeout(() => setIsLeaving(true), 2350);
    const completeTimer = window.setTimeout(() => setIsComplete(true), 2900);

    return () => {
      window.clearInterval(progressTimer);
      window.clearTimeout(leaveTimer);
      window.clearTimeout(completeTimer);
    };
  }, []);

  if (isComplete) return null;

  return (
    <div className={`${styles.loader} ${isLeaving ? styles.loaderLeaving : ""}`} role="status" aria-label="Loading Boatship">
      <div className={styles.loaderPanels} aria-hidden="true"><i /><i /></div>
      <div className={styles.loaderMark}>
        <div className={styles.loaderLogo}>
          <Image src="/brand/boatship-logo-black.png" alt="Boatship" fill priority sizes="(max-width: 760px) 82vw, 62vw" />
        </div>
        <span>CLIENT DELIVERY, ON COURSE</span>
      </div>
      <div className={styles.loaderProgress} aria-hidden="true"><strong>{String(progress).padStart(3, "0")}</strong><span>LOADING PROJECT WORKSPACE</span></div>
      <div className={styles.loaderTrack} aria-hidden="true"><i style={{ transform: `translateX(${progress - 100}%)` }} /></div>
      <div className={styles.loaderCut} aria-hidden="true"><span>CUT ALONG LINE</span><b>✂</b><i /></div>
    </div>
  );
}
