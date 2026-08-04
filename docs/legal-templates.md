# Legal and privacy templates

> **Templates only — legal review required. These documents are not counsel-approved and must not be published as final terms.** Version each approved document and record user/workspace acceptance in `policy_acceptances`.

## Privacy notice template

Describe controller identity, purposes, lawful bases selected by counsel, submission/account/billing/security data, recipients, transfers, retention classes, rights, complaint route, and security/privacy contacts. FormSentinel currently has no hosted production processing claim. DSAR identity is re-verified; deletion has a seven-day cancel grace, legal holds take precedence, and backup erasure can lag primary completion by up to 35 days.

## Terms template

Define service scope, acceptable use, account authority, plan limits, billing grace, temporary restrictions, human abuse review, appeals, availability exclusions, termination, liability, governing law, and change/acceptance versioning. Do not promise unavailable adapters or SLOs before launch approval.

## DPA template

Identify controller/processor roles per use case, documented instructions, confidentiality, security measures, subprocessor notice/objection, assistance, incident notice, audit terms, transfer mechanism, deletion/return, legal holds, and backup windows.

## Cookie notice template

The tenant session cookie is HTTP-only, SameSite=Lax, secure in production, and necessary. The separate operator cookie is HTTP-only, Secure, SameSite=Strict, and scoped to `/operator`. No analytics cookie is enabled by this template.

## Subprocessor template

List only contracted and enabled providers with purpose, location, transfer safeguard, and effective date. Reserved environment variables and local captures are not active subprocessors. Stripe, email, object storage, monitoring, and identity providers must not be listed as live until configured and reviewed.

## Retention and DSAR template

Default engineering classes are submissions 365 days, security 730 days, billing/audit 2,555 days, and private export artifacts 7 days; plan-specific shorter submission retention applies. Export artifacts are private and expiring. Deletion runs ordered database, object, then provider steps and records per-step evidence. An unavailable adapter yields partial—not completed—status. Legal holds are separately authorized and released.

## Security contact template

Replace `security@formsentinel.example` before publication. Provide a private reporting route, requested reproduction details without submission payloads or credentials, acknowledgement target, coordinated disclosure policy, and emergency escalation. The placeholder domain is not a monitored production contact.
