# Boatship product record

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Delivery teams managing client work and clients completing onboarding are equally important primary users. This priority was confirmed by the user on 2026-09-24.

## Product Purpose

Boatship connects client onboarding and project delivery in one shared workspace. Teams manage clients, tasks, forms, documents, approvals, and messages; clients see and complete their own work.

## Operating Context

Administrators and team members set up client workspaces and review progress. Clients sign in through an invitation or password reset, complete tasks and forms, upload documents, and communicate with the team. The codebase also includes internal product work, analytics, workload, integrations, and Hodi assistance.

## Capabilities and Constraints

- Preserve the existing admin/team/client roles, data model, and working task, document, form, message, and approval flows during redesign.
- The implementation uses Next.js App Router, Tailwind CSS, Neon PostgreSQL, and Prisma, with Cloudflare deployment through OpenNext.
- Product and client-work areas have distinct purposes; their relationship in navigation needs to be made clear.
- Plan names, prices, testimonials, service guarantees, and customer evidence remain undecided unless supplied by the user or verified in the product.

## Brand Commitments

The product name is Boatship. Existing Boatship logos and favicon are in `public/brand/`. The user has not confirmed which of the current public-site or app visual styles should lead the redesign.

## Evidence on Hand

The repository contains implemented product flows and UI copy. The public marketing export also contains older CohortIX studio material, so it is not reliable evidence for Boatship-specific customer claims or plans.

## Product Principles

1. Give delivery teams and clients equally clear routes to their next action.
2. Keep every decision connected to its project context and evidence.
3. Show progress and timing only when the underlying data supports the claim.
4. Make routine work easy to find, while keeping advanced settings available without dominating navigation.
