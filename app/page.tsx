import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Check, FileText, MessagesSquare, PanelsTopLeft, CircleHelp } from "lucide-react";
import styles from "./page.module.css";

export const metadata: Metadata = {
  title: "Boatship | Client onboarding and delivery in one place",
  description: "Keep client onboarding, project tasks, forms, documents, approvals, and conversations connected in one workspace.",
};

const steps = [
  { title: "Set up the work", description: "Create a client workspace and turn the onboarding plan into clear tasks and milestones." },
  { title: "Bring the client in", description: "Give clients one place to complete tasks, submit forms, and share the files your team needs." },
  { title: "Keep delivery moving", description: "Review submissions, make decisions, and continue the conversation beside the work." },
];

export default function HomePage() {
  return (
    <div className={styles.site}>
      <a className={styles.skip} href="#main">Skip to content</a>
      <header className={styles.header}>
        <Link href="/" className={styles.wordmark} aria-label="Boatship home"><span className={styles.mark} aria-hidden="true">b.</span><span>boatship</span></Link>
        <nav className={styles.nav} aria-label="Main navigation">
          <a href="#how-it-works">How it works</a>
          <a href="#for-teams">For teams and clients</a>
          <Link className={styles.navAction} href="/login">Sign in <ArrowRight size={17} aria-hidden="true" /></Link>
        </nav>
      </header>

      <main id="main">
        <section className={styles.hero} aria-labelledby="hero-title">
          <div className={styles.heroCopy}>
            <h1 id="hero-title">Client work,<br /><em>all in one place.</em></h1>
            <p>Bring onboarding, project delivery, files, decisions, and conversations into one shared workspace. Your team knows what needs attention. Your clients know what comes next.</p>
            <div className={styles.heroActions}>
              <Link className={styles.primaryAction} href="/login">Enter your workspace <ArrowRight size={18} aria-hidden="true" /></Link>
              <a className={styles.textAction} href="#how-it-works">See how it works <span aria-hidden="true">↓</span></a>
            </div>
            <p className={styles.accessNote}>Have an invitation? Use the sign-in link from your workspace administrator.</p>
          </div>
          <div className={styles.heroVisual} aria-label="Illustration of connected client work">
            <div className={styles.visualHead}><span>One connected workspace</span><span className={styles.visualDots} aria-hidden="true"><i /><i /><i /></span></div>
            <div className={styles.visualBody}>
              <div className={styles.visualLead}><span className={styles.visualLabel}>CLIENT DELIVERY</span><strong>From first request<br />to final handoff.</strong><p>Tasks, files, and decisions stay together.</p></div>
              <div className={styles.flow}>
                <div><span className={styles.flowIcon}><Check size={18} /></span><span><b>Plan the work</b><small>Tasks and milestones</small></span></div>
                <div><span className={styles.flowIcon}><FileText size={18} /></span><span><b>Collect what&apos;s needed</b><small>Forms and documents</small></span></div>
                <div><span className={styles.flowIcon}><MessagesSquare size={18} /></span><span><b>Review together</b><small>Approvals and messages</small></span></div>
              </div>
            </div>
            <span className={styles.visualFoot}>A view of the workflow · Illustrative</span>
          </div>
        </section>

        <section className={styles.bridge} aria-label="Product summary"><p>Less chasing. More clarity about the next step.</p><span>For the people doing the work and the people waiting on it.</span></section>

        <section className={styles.how} id="how-it-works" aria-labelledby="how-title">
          <div className={styles.sectionIntro}><h2 id="how-title">A clearer way to move client work forward.</h2><p>One flow connects the internal plan with the client&apos;s next action.</p></div>
          <div className={styles.steps}>{steps.map((step, index) => <article key={step.title}><span className={styles.stepNumber}>{String(index + 1).padStart(2, "0")}</span><h3>{step.title}</h3><p>{step.description}</p></article>)}</div>
        </section>

        <section className={styles.audiences} id="for-teams" aria-labelledby="audience-title">
          <div className={styles.audienceHeading}><h2 id="audience-title">One project.<br /><em>Two clear views.</em></h2><p>The team can manage the details while clients see exactly what they need to do.</p></div>
          <div className={styles.audiencePanels}>
            <article><div className={styles.panelIcon}><PanelsTopLeft size={24} strokeWidth={1.7} /></div><h3>For your team</h3><p>Track clients, tasks, milestones, documents, forms, and approvals together. See the work that needs a response and keep ownership clear.</p><span>Plan · Review · Deliver</span></article>
            <article><div className={styles.panelIcon}><CircleHelp size={24} strokeWidth={1.7} /></div><h3>For your clients</h3><p>Use a focused portal to complete assigned tasks, submit information, upload files, review requests, and message the team.</p><span>Understand · Submit · Respond</span></article>
          </div>
        </section>

        <section className={styles.closing} aria-labelledby="closing-title"><div><h2 id="closing-title">Ready to get back to the work?</h2><p>Sign in to your Boatship workspace to see your next steps.</p></div><Link className={styles.primaryAction} href="/login">Sign in to Boatship <ArrowRight size={18} aria-hidden="true" /></Link></section>
      </main>
      <footer className={styles.footer}><span className={styles.wordmark}><span className={styles.mark} aria-hidden="true">b.</span><span>boatship</span></span><p>Client onboarding and delivery, connected.</p><Link href="/login">Workspace sign in</Link></footer>
    </div>
  );
}
