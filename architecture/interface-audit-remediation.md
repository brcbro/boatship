# Interface audit remediation

Implemented in the working tree on 2026-10-14. This record describes UI behavior; it does not establish deployment or provider configuration.

## Document review and retrieval

Staff client workspaces and client portal document lists use `components/shared/DocumentViewer.tsx`. Viewing and downloading request authenticated binary content from `GET /api/documents/[id]/content`; list metadata never needs binary content. The current file uses no version query, and previous versions use the zero-based history index. Downloads request `disposition=attachment` and save the selected version's filename.

The viewer displays only PDF, PNG, JPEG, and WebP responses inline. Image previews use a short-lived blob URL; PDF previews use a titled iframe with a download fallback. Fetches are cancelled when a preview closes or changes, and blob URLs are released. Loading, unavailable content, failed retrieval, retry, and replacement states are visible. A known missing current file disables its preview and download but keeps replacement and older versions reachable. Previous-version selection explicitly explains that review status belongs to the current file.

Replacement uses the existing upload URL and JSON upload routes with `documentId`. It preserves the document's task/engagement context, keeps version history, and updates the local list with the server's metadata. The UI explains that replacement resets the review status. Staff replacement is available with `clients.manage`; approval/rejection/note controls require `documents.review`. Staff without review permission can still retrieve authorized files and read the saved notes. Form review controls similarly follow `forms.review`.

Portal uploads include optional `engagementId`; task-linked uploads follow the task's engagement. Staff and portal lists label account-wide and engagement files, including historical engagement fallback labels. The staff scope control can include account-wide files alongside an engagement. Bulk review selects only currently visible files and clears its selection when the filter changes.

## Navigation and input accessibility

The staff sidebar preserves existing route destinations in five task groups. Tools and settings are initially collapsed except when the current route belongs to that group; users can explicitly expand or collapse it. Client accounts, project operations, and workspace policies have distinct labels. Analytics navigation follows `analytics.view`, and admin-only webhooks/accounting do not appear to team members. Service templates and team directory remain available for useful read access. Mobile drawer focus trapping excludes controls inside collapsed groups.

`Dropdown` accepts native select attributes including `id`, `name`, `aria-labelledby`, `aria-describedby`, and `aria-invalid`. An optional `label` creates an associated label and stable control ID. Explicit labels are no longer overridden by the generic placeholder accessible name. Staff client-page and task-editor controls use these associations.

Sign-in password visibility, password-reset navigation, and the home link have at least 44px touch targets. Password visibility exposes its pressed state and controlled fields. Portal mobile menus move focus into their links, close with Escape, restore the trigger's focus, and scroll within short viewports. Existing desktop and mobile navigation destinations are preserved.

`TaskBoard` and `TaskDetailModal` accept `canEdit` for view-only staff access. Mutation handlers also guard it; create, reorder, delete, subtask creation, and validation actions are hidden, while task state and details remain readable. The staff client page passes its current `clients.manage` permission. Server authorization remains the source of truth.

## Engagement operations and portal context

The staff project operations page retains an all-client overview and adds client/engagement filters, with an explicit account-wide option and optional inclusion of account work alongside an engagement. The delivery health summary remains account-level and is labelled accordingly. Staff with `clients.manage` can create milestones or client approval requests for an open engagement or the account; completed/cancelled engagements are unavailable for new work. Input is retained on failure.

Client approvals and documents support an initial `engagementId` query, context selectors, account-wide inclusion, and readable context labels. Approval decisions are unavailable for completed/cancelled engagements while their history remains visible. The client engagement page retrieves scoped task, milestone, approval, document, and form metadata in parallel. Its resource links preserve the engagement query when opening forms, documents, approvals, or messages. Account-wide resources are included explicitly, preserving legacy records.

## Verification boundaries

Targeted ESLint checks cover the changed UI components. Desktop/mobile visual and interaction verification should use an authenticated local or staging fixture; source review and a clean build alone do not establish production browser behavior. Provider credentials and production data are unnecessary for these UI checks.

Local browser verification on 2026-10-15 used synthetic users and a fresh loopback database. Staff current/history image previews and the selected historical download passed. Intake invalid email blocked progression and draft/discard feedback was visible. At 390px width, the portal menu moved/restored focus with Escape, native form close/reopen restored answers, layout had no horizontal overflow, and a valid brief submitted successfully with the submitted/read-only state. Screenshots are local QA artifacts under `.data/qa-proof`; no production credentials or customer files were used. Hosted browser/device and PDF-browser-specific rendering remain release checks.
