# Phase 4 runbooks

- **Deploy/rollback:** verify backup, migration plan, image digest, readiness dependencies, and staging evidence; manually approve production. Roll back application only when schema-compatible; use run-forward/restore for data.
- **Migrations:** stop on lock/constraint failure, preserve logs and correlation ID, do not run down SQL, and choose corrected forward migration or tested restore.
- **Stripe replay/reconcile:** verify endpoint mode and signature, find unique provider event ID/hash, replay from Stripe, then reconcile provider state to the local mirror. A fixture is never live success.
- **Dead letters:** inspect IDs and redacted errors, repair the adapter/configuration, create an audited replay with a new dedupe key, and monitor queue age/retry/dead-letter metrics.
- **Key rotation:** create independent new material, deploy dual-read/single-write where supported, validate, revoke old keys, and audit. Never reuse SERVICE_TOKEN for users, API, MCP, or operators.
- **Storage/scanner outage:** mark capability unavailable, reject new files when quarantine cannot be guaranteed, keep existing files private/quarantined, and never mark scans or deletion complete.
- **Abuse:** bounded signals open a case; a human records reason/ticket and only temporary scoped restrictions. Show customer state/SLA, accept appeal, independently review, and reinstate/lift when warranted. No automatic permanent suspension.
- **Privacy/DSAR:** re-verify identity, honor grace/cancel and legal holds, create private expiring exports, execute database/object/provider cleanup in order, retry idempotently, and leave partial if any adapter lacks evidence. Disclose the 35-day backup window.
- **Backup restore:** isolate target, restore encrypted backup, validate schema and tenant counts/checksums, rotate exposed credentials, run read-only smoke, document RPO/RTO evidence, then authorize traffic.
- **Incident response:** assign commander, preserve immutable admin/security audit, use correlation IDs without payload/token/email/raw IP, contain, notify per reviewed policy, recover, and complete a blameless follow-up.
