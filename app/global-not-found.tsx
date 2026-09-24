import type { Metadata } from "next";
import Link from "next/link";
import styles from "./page.module.css";

export const metadata: Metadata = {
  title: "Page not found | Boatship",
  description: "That page could not be found. Return to Boatship or sign in to your workspace.",
};

export default function GlobalNotFound() {
  return (
    <html lang="en">
      <body className={styles.notFoundBody}>
        <main className={styles.notFound}>
          <Link href="/" className={styles.wordmark} aria-label="Boatship home"><span className={styles.mark} aria-hidden="true">b.</span><span>boatship</span></Link>
          <p className={styles.notFoundCode}>404 / PAGE NOT FOUND</p>
          <h1>This page has sailed on.</h1>
          <p>The address may have changed, or the page may no longer exist. Head home or open your workspace.</p>
          <div className={styles.notFoundActions}><Link className={styles.primaryAction} href="/">Go to homepage</Link><Link className={styles.textAction} href="/login">Sign in to Boatship</Link></div>
        </main>
      </body>
    </html>
  );
}
