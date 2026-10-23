import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Check, FileText, MessagesSquare, PanelsTopLeft, UserRound } from "lucide-react";
import styles from "./page.module.css";

export const metadata: Metadata = {
  title: "Boatship | Client work in one place",
  description: "Keep client accounts, engagements, tasks, forms, documents, approvals, and conversations connected in one workspace.",
};

const steps = [
  { title: "Set up the work", description: "Create a client workspace and turn each engagement into clear tasks and milestones." },
  { title: "Bring the client in", description: "Give clients one place to complete tasks, submit forms, and share the files your team needs." },
  { title: "Keep delivery moving", description: "Review submissions, make decisions, and continue the conversation beside the work." },
];

export default function HomePage() {
  return (
    <div className={styles.site}>
      <a className={styles.skip} href="#main">Skip to content</a>
      <header className={`${styles.header} ${styles.wrap}`}>
        <Link href="/" className={styles.wordmark} aria-label="Boatship home"><span className={styles.mark} aria-hidden="true">b</span><span>boatship</span></Link>
        <nav className={styles.nav} aria-label="Main navigation">
          <a href="#how-it-works">How it works</a>
          <a href="#for-teams">For teams and clients</a>
          <Link className={styles.navAction} href="/login">Sign in <ArrowRight size={16} aria-hidden="true" /></Link>
        </nav>
      </header>

      <main id="main">
        <section className={`${styles.hero} ${styles.wrap}`} aria-labelledby="hero-title">
          <div className={styles.heroCopy}>
            <span className={styles.eyebrow}>Client OS for delivery teams</span>
            <h1 id="hero-title">Every client, every <em>next step</em>, one place.</h1>
            <p>Bring client accounts, engagements, files, decisions, and conversations into one shared workspace. Your team knows what needs attention. Your clients know what comes next.</p>
            <div className={styles.heroActions}>
              <Link className={styles.primaryAction} href="/login">Enter your workspace <ArrowRight size={18} aria-hidden="true" /></Link>
              <a className={styles.textAction} href="#how-it-works">See how it works</a>
            </div>
            <p className={styles.accessNote}>Have an invitation? Use the sign-in link from your workspace administrator.</p>
          </div>

          <div className={styles.heroVisual} role="img" aria-label="Illustration of the Boatship team workspace: a navigation rail, a summary of work waiting, and a list of client tasks">
            <div className={styles.visualRail} aria-hidden="true">
              <b><i />Boatship</b>
              <small>Work</small>
              <span className={styles.on}>Today</span><span>Approvals</span><span>Messages</span><span>Clients</span><span>Projects</span>
              <small>Operate</small>
              <span>Team</span><span>Analytics</span>
            </div>
            <div className={styles.visualMain} aria-hidden="true">
              <div className={styles.visualTop}><span>Search clients, tasks, documents…</span><em>New client</em></div>
              <div className={styles.visualTitle}>Today</div>
              <div className={styles.visualStats}>
                <div><small>Awaiting approval</small><strong>7</strong></div>
                <div><small>Due this week</small><strong>18</strong></div>
                <div><small>Unread threads</small><strong>4</strong></div>
              </div>
              <div className={styles.flow}>
                <div><span className={styles.flowIcon}><FileText /></span><span><b>Onboarding form submitted</b><small>Northwind · needs review</small></span><i className={`${styles.pill} ${styles.pillWarn}`}>Review</i></div>
                <div><span className={styles.flowIcon}><Check /></span><span><b>Q4 deliverable</b><small>Acme · milestone 3 of 4</small></span><i className={`${styles.pill} ${styles.pillOk}`}>On track</i></div>
                <div><span className={styles.flowIcon}><MessagesSquare /></span><span><b>Kickoff deck feedback</b><small>Contoso · 2 new messages</small></span><i className={`${styles.pill} ${styles.pillBrand}`}>Reply</i></div>
              </div>
            </div>
          </div>
        </section>

        <section className={styles.bridge} aria-label="Product summary"><div className={styles.wrap}><p>Less chasing. More clarity about the next step.</p><span>For the people doing the work and the people waiting on it.</span></div></section>

        <section className={`${styles.how} ${styles.wrap}`} id="how-it-works" aria-labelledby="how-title">
          <div className={styles.sectionIntro}><h2 id="how-title">A clearer way to move client work forward.</h2><p>One flow connects the internal plan with the client&apos;s next action.</p></div>
          <div className={styles.steps}>{steps.map((step, index) => <article key={step.title}><span className={styles.stepNumber}>{index + 1}</span><h3>{step.title}</h3><p>{step.description}</p></article>)}</div>
        </section>

        <section className={`${styles.audiences} ${styles.wrap}`} id="for-teams" aria-labelledby="audience-title">
          <div className={styles.audienceHeading}><h2 id="audience-title">One client workspace.<br /><em>Two clear views.</em></h2><p>The team manages the details while clients see exactly what they need to do.</p></div>
          <div className={styles.audiencePanels}>
            <article><div className={styles.panelIcon}><PanelsTopLeft size={22} strokeWidth={1.9} /></div><h3>For your team</h3><p>Track clients, tasks, milestones, documents, forms, and approvals together. See the work that needs a response and keep ownership clear.</p><span>Plan · Review · Deliver</span></article>
            <article><div className={styles.panelIcon}><UserRound size={22} strokeWidth={1.9} /></div><h3>For your clients</h3><p>A focused portal that opens on the next step: complete tasks, submit information, upload files, review requests, and message the team.</p><span>Understand · Submit · Respond</span></article>
          </div>
        </section>

        <section className={styles.closing} aria-labelledby="closing-title"><div className={styles.wrap}><div><h2 id="closing-title">Ready to get back to the work?</h2><p>Sign in to your Boatship workspace to see your next steps.</p></div><Link className={styles.primaryAction} href="/login">Sign in to Boatship <ArrowRight size={18} aria-hidden="true" /></Link></div></section>
      </main>
      <footer className={styles.footer}><div className={styles.wrap}><span className={styles.wordmark}><span className={styles.mark} aria-hidden="true">b</span><span>boatship</span></span><p>Client work and delivery, connected.</p><Link href="/login">Workspace sign in</Link></div></footer>
    </div>
  );
}
