# Boatship: full layout brief for a redesign (Google Stitch)

This file describes every screen in Boatship as it exists today: who uses it, what is on it, what each control does, and the states it can be in. It is written so a design tool (Google Stitch, Figma AI, or a designer) can produce a complete new visual design without reading the code. Nothing here prescribes the current look; where the current look matters it is marked **Current** so it can be kept or discarded.

Routes, data and behaviour are fixed by the product. The redesign may change layout, hierarchy, density, colour, type, iconography, motion and copy tone, but should keep the information and actions listed for each screen.

---

## 1. Product in one paragraph

Boatship is a client delivery workspace for a small agency or consultancy. **Staff** (two roles: admin and team member) run client accounts, each with one or more **engagements** (an onboarding, a project, or an ongoing service). Each engagement has **tasks**, **forms** the client fills in, **documents** the client uploads for review, **messages**, **milestones** and **approvals**. Staff also plan the company's own **products**. An AI assistant called **Hodi** answers questions about the workspace and proposes actions that staff approve. **Clients** sign in to a separate **portal** that shows only their own work: their next step, tasks, forms, documents, approvals and messages. Everything is one web app with two shells, a public marketing home page and a sign-in page.

## 2. Users and roles

| Role | Where they land | What they can do |
| --- | --- | --- |
| Admin | Staff workspace, `/dashboard` | Everything. Only admins see Accounting, Webhooks, team management, product settings and the client "Clone/Pause/Invite" actions. |
| Team member | Staff workspace, `/dashboard` | Day-to-day delivery on the clients assigned to them. Some pages are gated by granular permissions: `clients.manage`, `documents.review`, `forms.review`, `analytics.view`. When a permission is missing the controls are shown read-only or hidden, with a short explanation. |
| Client | Client portal, `/portal` | Sees only their own company's engagements, tasks, forms, documents, approvals and messages. Cannot see staff pages. |

Sign-in is one page for all roles. After sign-in, staff go to the dashboard and clients to the portal.

## 3. Global structure

### 3.1 Staff shell (every `/…` staff route)

- **Left rail** with the brand mark at the top, three groups of links, and a footer.
  - **Work:** Today (`/dashboard`), Inbox (`/tasks`), Messages, Calendar, Clients, Projects.
  - **Operate:** Products, Team, Workload, Analytics (permission-gated), Accounting (admin only).
  - **Hodi:** Assistant (`/agent`), Work queue (`/hodi`).
  - **Footer:** Settings link, then the signed-in person (initial avatar, name, role) and a log-out button.
  - The rail collapses to an icon-only strip (preference remembered). Below desktop width it becomes an off-canvas drawer opened from a menu button.
  - Inside any Settings route the rail swaps to the **settings list** with a "Back to work" link: Overview, Account, Workspace policies, Service templates, Forms, Reminders, Automations, Integrations, Webhooks (admin), MCP access, Compliance.
- **Top strip** (sticky): menu button (mobile), brand mark (mobile), a wide **search button** that opens the command palette (⌘K / Ctrl+K), then on the right a **Hodi** button, a **theme toggle** (system / light / dark) and a **notification bell** with an unread count.
- **Content area**: scrolls independently of the rail on desktop; max content width about 1320px with side gutters.
- **Hodi drawer**: a right-hand panel opened by the Hodi button. On wide screens it is a fixed-width column beside the content; on narrower screens an overlay with a scrim. Contains the chat (see 4.14) in a compact form, a context chip ("Hodi knows you are looking at Harbour Studio") when opened on a client record, a product record or the Inbox, a chat-history menu, a link to the full `/agent` page and a close button. Escape closes it.
- **Command palette** (modal): a search field; results list grouped as navigation links (every rail and settings route) and search hits (clients, tasks, documents, vessels) with type labels; arrow keys and Enter.
- **Notification bell** (popover): list of notifications, each with title, body, time, read state; "Mark all read"; clicking one opens its link.

### 3.2 Client shell (every `/portal/…` route)

- **Top bar**: brand mark, four primary links (Home, Tasks, Documents, Messages), a **More** menu (Engagements, Forms, Approvals, Account), the account name and a log-out control, and a notification bell.
- On phones the four primary links move to a **bottom tab bar** with More as the fifth tab.
- Content is a single centred column.

### 3.3 Public pages

- **Home** (`/`): marketing page. Hero with headline, one-paragraph pitch, primary "Sign in" call to action and a secondary link; a strip showing the product (currently a miniature of the staff shell); a "how it works" section with three numbered steps; two audience panels (for teams, for clients) each with three to four bullet benefits; a closing call-to-action card; a quiet footer with the brand and a sign-in link.
- **Sign in** (`/login`): email, password (with show/hide), "Sign in" button, "Forgot password?" link that swaps the form for an email-only reset request, inline error line, and a hint "Use the account created by your workspace administrator". **Current**: split layout with a brand statement panel on the left on large screens.
- **Not found**: brand, "Page not found", link home.

## 4. Staff screens

Each screen lists: purpose, header, sections in order, components used, actions, and states (loading, empty, error, permission-limited).

### 4.1 Today (`/dashboard`)

- **Purpose:** what needs a decision or follow-up right now.
- **Header:** "Today" (greeting is acceptable), description "Client work that needs a decision or follow-up." Action: "New client".
- **Sections:**
  1. **Figures row** (4 to 5 stat tiles): total clients, active engagements, overdue tasks, average onboarding days, team count. Each tile: label, big number, small detail.
  2. **Needs attention**: a list of clients whose onboarding health is "waiting on client", "blocked internally" or "ready to launch". Each row: client name, company, health state badge, score, the blockers as short chips (missing form, missing upload, approval, overdue task, blocked task), owner, and a link into the client record.
  3. **Recent clients** (up to 8 cards or rows): name, company, status badge, pipeline stage, progress bar with "x of y tasks", owner name, updated date. Click opens the client record.
  4. **Products** summary: each company product with stage badge, open work count, next milestone, current release. Link to Products.
- **States:** loading skeletons; empty "No clients yet" with a "New client" action; error line with retry; products block may fail independently ("Product summary is unavailable right now").

### 4.2 Inbox (`/tasks`)

- **Purpose:** one triage list of everything waiting on a person.
- **Header:** "Inbox", description, "Refresh" action.
- **Filter chips** with counts: Everything, Approvals, Form submissions, Messages. A small keyboard legend (j/k move, Enter review or open, o open).
- **List** (newest first). Row anatomy: type badge (Approval / Form / Message), title, one-line detail, timestamp, and for approvals an "Open" link. One row is always the **highlighted** row (keyboard cursor).
  - **Approval rows** (two kinds: an agent's MCP write request, or a task completion awaiting manager sign-off). Expanding a row reveals an inline review panel: the request payload (for MCP) in a code block, a "Reason or reviewer note" text area (optional to approve, required to reject), "Reject" and "Approve request / Approve completion" buttons, and an "Open the task" link.
  - **Form rows**: form name, client, risk score. Opening goes to the client record's Forms tab.
  - **Message rows**: "Message from {client}", unread count, a quote of the latest message. Opening marks the thread's notifications read and goes to the Messages page on that thread.
- **States:** loading; "Inbox zero" empty state; partial-load warning ("Some of the Inbox could not load: …").

### 4.3 Messages (`/messages`)

- **Purpose:** staff side of client conversations.
- **Header:** "Messages", description.
- **Conversation picker** card: a client dropdown ("name · company"), then a **work context** dropdown (All work, Account-wide, or a named engagement) and an "Also show account-wide messages" checkbox when an engagement is chosen.
- **Thread panel** (tall card): header with client avatar initial, company, client name and a live/polling indicator ("Checking for updates"); message list grouped by day with author name, role and time; client messages visually distinct from staff messages; composer with text area, "Send message" button, hint "Ctrl+Enter to send". Sending is blocked with an explanation when the engagement is completed or cancelled.
- **Side column** (desktop): "Client account" card (company, onboarding status badge, task completion %, pipeline stage, owner) and "Conversation pulse" card (client message count, thread active date).
- **States:** "Select a client" empty state; loading; error line; "No messages yet".

### 4.4 Calendar (`/calendar`)

- **Purpose:** Google Calendar events and task deadlines in one view.
- **Header:** "Calendar", description, actions: previous / today / next, week or month toggle, "Connect Google Calendar" when not connected.
- **Grid:** month or week grid; each day cell lists items as small chips: tasks (with client name and status colour) and calendar events (with time). Clicking an item opens a detail popover with title, client, due or time, and a link to the client record or the external event.
- **States:** not connected (explain and link to Integrations); empty day cells; error.

### 4.5 Clients list (`/clients`)

- **Purpose:** find and open a client account.
- **Header:** "Clients", description, action "New client".
- **Filter bar:** search box, status filter (Not started, In progress, Completed, On hold), pipeline stage filter (Intake, KYC, Compliance, Kickoff, Go live, Done), owner filter, tag filter; "Clear filters".
- **Table** (desktop) / **cards** (phone). Columns: name and company, status badge, pipeline stage, progress bar with "x of y", owner, vessel count, updated date. Row click opens the record.
- **States:** loading, "No clients match" with clear filters, "No clients yet" with New client.

### 4.6 New client (`/clients/new`)

- **Purpose:** create an account and start the right onboarding playbook.
- **Form** in one card: client name, company, primary contact email, assigned owner (dropdown), service template (dropdown with description), tags (comma separated), optional custom fields (Vessel IMO, Flag). Buttons: "Create client", "Cancel".
- **States:** validation errors inline; submitting; success goes to the new record.

### 4.7 Client record (`/clients/[id]?tab=…`)

- **Purpose:** everything about one client account.
- **Sticky header:** back link "← Clients", client name, status badge (Not started / In progress / Completed / On hold) and a "Paused" badge when paused, subtitle "company · primary email", a meta row (Owner, Next milestone, Progress "x of y tasks"), actions for staff with the manage permission: "Clone", "Pause" or "Resume", "Invite client" (primary). The **tab row** sits on the header's bottom edge with counts on Forms (submissions awaiting review) and Documents (files pending review).
- **Tabs:**
  1. **Overview**: "Account owner" card (owner dropdown, paused notice with reason and since-date); "Work across engagements" card (progress bar, company, email, Drive folder link, created, updated); "Engagements" summary card (active · total, "View engagements"); "Legacy onboarding controls" card (status dropdown, pipeline stage dropdown); "Tags & custom fields" card (tags input with chips, Vessel IMO, Flag, "Save tags & fields", plus a read-only list of details captured from client forms); then **People** (contact directory: name, email, directory role dropdown, Remove; "Add contact" opens a modal with name, email, role) and **Timeline** (activity list: actor, action, time).
  2. **Engagements**: intro line, "New engagement" (modal: name, type Onboarding/Project/Ongoing service, target date). Cards per engagement: name, type, status badge, "x of y tasks", progress bar, owner and target date, status dropdown (not for the legacy onboarding engagement), "Open tasks".
  3. **Tasks**: engagement dropdown, then the **task board** (see 6.1) scoped to that engagement.
  4. **Forms**: "Export CSV"; list rows: form name, submitted / reviewed dates, risk score, status badge (Not started / Submitted / Reviewed). Row opens the **form review modal**: status and risk badges, template description, the responses as label/value pairs (or a link to the external Google Form), a review note text area, buttons "Open Google Form", "Close", "Mark reviewed" (permission-gated).
  5. **Documents**: scope dropdown (all, account-wide, or an engagement) with "Include account-wide files" checkbox; bulk bar for reviewers ("Select visible files", "Approve selected (n)", "Reject selected"); one card per document: checkbox, file name, uploaded time, size, version count, engagement, type, expiry (red when expired), status badge, an inline **document viewer** (preview, download, version history, replace file), review note, buttons "Approve current file", "Reject current file", "Reset to pending".
  6. **Messages**: work-context dropdown, "Open in Messages" link, the client thread (bubbles with author and time), composer with Send.
  7. **Billing**: "Engagement summary" card (active, completed, work complete %, client since) and "Invoices and ledger" card (explanatory text, "Open the ledger" for admins, Drive folder link). Per-client invoices do not exist yet.
  8. **Vessels**: count line, "Add vessel"; table (desktop) or cards (phone) with name, IMO, flag, type, class society, notes, Edit, Delete; add/edit modal with those fields.
- **Modals** also on this page: Clone client (optional new primary email), Pause (reason, required), Invite confirmation ("An invite email was sent to …").
- **States:** loading; "Client not found" with back link; success and error banners under the header.

### 4.8 Projects (`/projects`)

- **Purpose:** cross-client project operations.
- **Header:** "Project operations", description.
- **Sections:** client selector; **Milestones** (title, due date, status, linked tasks; add milestone form); **Approvals** requested from the client (subject, kind, status, requested by, decision and feedback); **Schedules** (meetings with start/end); **Workload signals** and **health** summary cards. Each section has an add form for staff.

### 4.9 Products (`/products`, `/products/new`, `/products/[id]?tab=…`)

- **List:** header "Products", action "New product"; cards: name, type (Internal tool / SaaS / Other), stage badge (Idea, Building, Beta, Live, Paused, Retired), owner, open work count, next milestone, current release.
- **New product:** name, type, stage, description, owner, website URL; "Create product".
- **Record** (same sticky header pattern as the client record): eyebrow with type, name, stage badge, description, meta (Owner, Next milestone, Open work), "Website" link. Tabs:
  1. **Overview**: four stat tiles (type, owner, open work, current release); "Next milestone" and "Work in progress" cards; "Recent activity" list.
  2. **Roadmap**: milestone list with status dropdown; "Add milestone" form (title, description, target date, owner).
  3. **Work**: work items with priority, assignee, due date, milestone, status dropdown; "Add work item" form.
  4. **Releases**: release history (version, environment, status dropdown, notes, date, commit, repository, included work, deployment link); "Add release" form (version, environment, status, date, notes, URL, repository, commit SHA, included work checkboxes).
  5. **Settings**: product details form (admin) or read-only details; **Access** list of members with role badges and Remove; add/update member form (staff, role Viewer/Editor).

### 4.10 Team (`/team`)

- **Header:** "Team", "Staff accounts", action "Invite team member" (admin).
- **Table:** name, email, role badge (Admin / Team), permissions summary, assigned client count, status (active / invited), actions: edit permissions (modal with permission checkboxes), resend invite, deactivate.

### 4.11 Workload (`/workload`)

- **Header:** "Workload", description.
- **Per team member** card or column: name, role, counts (open client tasks, overdue, product work items), a bar or meter, and the list of open items with client/product, due date and status.

### 4.12 Analytics (`/analytics`, permission-gated)

- **Header:** "Analytics", description.
- **Figures row:** clients by status, active engagements, overdue tasks, average onboarding days.
- **Charts:** clients by status (donut or bars), onboarding health distribution, overdue trend, recent activity list.
- **State:** "You do not have access" when the permission is missing.

### 4.13 Accounting (`/accounting`, admin only)

- **Header:** "Accounting", month picker, "Add entry".
- **Ledger table:** title, category, amount, month, due date, status (Planned / Paid / Overdue), paid by, split mode and splits; edit and delete per row; totals footer.
- **Non-admin state:** "Admin access required".

### 4.14 Hodi Assistant (`/agent`)

- **Purpose:** chat with the workspace assistant.
- **Layout:** left **chat history** rail ("New chat", list of chats with title and date); main column with a header (bot mark, chat title, status dot "Ready / Working / Setup required", connected-apps menu, delete chat).
- **Empty chat:** centred welcome ("What can I help with?") and four suggestion buttons.
- **Transcript:** user messages as bubbles on the right, assistant replies as rich text (markdown with tables, lists, code, links) on the left; a collapsible "Hodi activity" block listing tool calls and their state; per-message actions (Copy, Edit and resend, Improve).
- **Action proposals:** cards "Review action" with a title, the changes as bullets or a before/after list, expiry, "Approve and create" and "Decline"; after approval a status line with "Open result" and "Continue plan".
- **Composer:** single-line-growing text area, send button (turns into Stop while generating), hint "Enter to send · Shift+Enter for a new line".
- **Setup required state:** a card listing what is missing (API keys, Google Drive connection) with a "Refresh status" button.
- The **drawer** variant (3.1) shows the same transcript and composer without the history rail; history moves to a menu.

### 4.15 Hodi Work queue (`/hodi`)

- **Purpose:** what the assistant has done and is proposing.
- **Sections:** proposed actions awaiting approval (same cards as above), automation runs (rule, trigger, result, time), and a log of executed actions with links to the records they created.

### 4.16 Settings hub (`/settings`) and settings pages

- **Hub:** "Everything you configure", a grid of cards, one per settings area, each with icon, name and one-line description.
- **Account** (`/account`): profile (name, email), change password, **Appearance** (theme picker: System / Light / Dark), notification preferences.
- **Workspace policies** (`/workspace`): organisation name, defaults that apply to every client (review requirements, retention), permission foundations.
- **Service templates** (`/templates`): list of templates with publish status and version; editor with name, description, industry, and an ordered task list (title, type, assigned role, section, due days, priority, requires upload, linked form).
- **Forms** (`/forms`): form templates list; editor with name, description, mode (native or Google Form URL), and fields (key, label, type, required, options).
- **Reminders** (`/reminders`): "Reminder automation": scan results (overdue work, tasks with no recent Git activity, completions needing evidence) as a list with "Send reminder" per row and "Send all".
- **Automations** (`/automations`): rules Hodi runs (trigger, condition, action, enabled toggle); add rule form.
- **Integrations** (`/integrations`): connected apps per signed-in member (Google Drive, Google Calendar, Git providers, email) with Connect / Disconnect, plus a list of delivery jobs with status.
- **Webhooks** (`/webhooks`, admin): endpoints (name, URL, events, active), add form, recent deliveries with retry.
- **MCP access** (`/mcp`): issued credentials (name, scopes, created, last used, revoke) and "Issue credential".
- **Compliance** (`/compliance`): GDPR export and delete tools, audit log table, demo seed controls.

## 5. Client portal screens

### 5.1 Home (`/portal`)

- **Header:** eyebrow with company name, "Hello, {first name}", a line saying how many things are waiting.
- **Your next step** card (the single most important item: a task, form, upload or approval) with its title, due date and one primary button. **Current**: this is the one orange element.
- **Your progress** card (completed of total, progress bar) and **Need a hand?** card (link to Messages).
- **Current engagements**: cards with name, status, progress; "View all".
- **Also open**: the next few open tasks; "View all".
- **Shortcuts** row: Forms (n to complete), Documents, Approvals (n waiting), Messages.
- **States:** "Your account needs a client workspace" and "We couldn't load your workspace".

### 5.2 Tasks (`/portal/tasks`)

- Engagement filter; task list grouped by section; each task: title, description, due date, status badge, type chips (Upload, Form, Client facing), subtasks with checkboxes, and the action the client can take (upload a file, open the form, mark done, add a comment). Completed tasks collapse.

### 5.3 Forms (`/portal/forms`)

- List of assigned forms with status; opening a native form shows the fields (text, textarea, email, dropdown, date, file, number, checkbox) with validation, a draft autosave notice, "Save draft" and "Submit". Google-Form-backed forms show an embed or link and a "Mark as submitted" button.

### 5.4 Documents (`/portal/documents`)

- Requested uploads grouped by engagement; each document: file name, uploaded time, status (Pending review / Approved / Rejected) with the reviewer's note when rejected, version history, "Upload new version"; an upload drop zone with type and size limits (25 MB).

### 5.5 Approvals (`/portal/approvals`)

- Requests from the delivery team: subject, description, kind, requested date; "Approve" and "Request changes" with a feedback text area; decided items show the decision and date.

### 5.6 Messages (`/portal/messages`)

- Work-context dropdown (All work, Account-wide, engagements); thread with staff messages distinct from the client's own; composer with Send.

### 5.7 Engagements (`/portal/engagements`, `/portal/engagements/[id]`)

- List of engagements with status and progress; detail page with the engagement's tasks, forms, documents and milestones.

### 5.8 Account (`/portal/account`)

- Name, email, company, change password, appearance (theme), sign out.

## 6. Shared components (what the kit must cover)

1. **Task board** (staff and portal): grouped by section with counts, List / Kanban toggle, "Sections" and "Status" grouping, search box, "+ Task" (staff), rows with checkbox, title, priority badge, type chips, assignee, due date, status badge; expanding a task shows description, subtasks, dependencies, internal notes (staff), comments thread, evidence panel (files and links proving completion), and reorder up/down.
2. **Buttons:** primary, accent (one per screen), secondary, ghost, danger; sizes sm/md/lg; link-styled button.
3. **Fields:** input, textarea, native select / dropdown, label, hint, checkbox; invalid state; disabled state.
4. **Card**, **stat tile** (label, figure, detail; tinted variants), **badge** (neutral, success, warning, danger, info, brand, accent), **progress bar**, **keyboard key**.
5. **Page header** (eyebrow, title, description, actions), **section heading** (title + action), **record header** (sticky: back, title, badges, subtitle, meta pairs, actions, tabs).
6. **Tabs** (link tabs with an active underline and optional counts).
7. **Empty state** (title, description, optional action).
8. **Modal** (centred dialog on desktop, bottom sheet on phones; title, description, body, footer buttons).
9. **Filter chips** with counts, **list rows** with a keyboard-highlight state.
10. **Document viewer** (preview, download, versions, replace).
11. **Chat** pieces: user bubble, assistant rich text, tool-activity disclosure, proposal card, composer.
12. **Toasts / banners:** success (green), error (red), warning (amber) lines under the page header.
13. **Theme toggle** and **theme picker**; everything must work in light and dark.

## 7. Interaction and accessibility rules to keep

- Every colour from a token; both themes legible; visible focus rings.
- Touch targets at least 44px on phones.
- Modals trap focus and close on Escape; the mobile rail drawer does the same.
- Keyboard: ⌘K / Ctrl+K palette; Inbox j/k/Enter/o/Escape; Enter sends in chat, Shift+Enter newline; Ctrl+Enter sends a client message.
- Reduced motion respected; short fades only.
- Status colours stay attached to status, never decoration.

## 8. Current visual system (optional reference)

- **Current palette:** bone canvas `#F7F5EF`, white panels, warm-grey borders `#DEDACD`, ink `#121826`, cobalt brand `#1E3FD6`, signal orange accent `#FF5A1F`, status red `#C8321E`, green `#1F8A5A`, amber `#B5730A`. Dark: canvas `#0F1320`, panels `#161B2C`, brand `#6F8CFF`, accent `#FF7A4A`.
- **Current type:** Bricolage Grotesque for titles and figures, Figtree for body, Space Mono for IDs, dates and keyboard hints.
- **Current rule:** orange appears once per screen (headline action, active rail marker, brand mark); cobalt for everything else interactive.
- **Current layout numbers:** rail 15.5rem (4.25rem collapsed), top strip 3.5rem, content max 1320px, gutters 1rem phone / 2.5rem desktop, card radius 14px.

## 9. Suggested order for designing

1. Shells first: staff rail + top strip + Hodi drawer; client top bar + bottom tabs.
2. Dashboard, Inbox, Clients list, Client record (all eight tabs), Messages.
3. Task board (the densest component), form review modal, document card with viewer.
4. Portal home, portal tasks, portal forms, portal documents.
5. Hodi chat (page and drawer), proposal card.
6. Products list and record, Projects, Workload, Analytics, Accounting.
7. Settings hub and the eleven settings pages (share one form layout).
8. Public home and sign-in.
9. Dark theme pass over everything, then phone layouts.

## 10. Prompt starter for Stitch

> Design a B2B client-delivery web app called Boatship with two shells: a staff workspace (left navigation rail with groups Work / Operate / Hodi, sticky top bar with search, assistant button, theme toggle and notifications, and a right-hand AI assistant drawer) and a client portal (top bar with Home, Tasks, Documents, Messages and a More menu; bottom tabs on mobile). Produce the screens in section 4 and 5 of this brief with the components in section 6. Keep light and dark themes, a single headline-action colour per screen, and dense but calm data layouts. Use the content, controls and states exactly as listed.
