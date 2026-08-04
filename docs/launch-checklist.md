# Launch checklist

- [ ] Legal templates reviewed and approved versions recorded; real privacy/security contacts installed.
- [ ] PostgreSQL web auth/control plane implemented, tested for IDOR/roles, and required readiness probe green.
- [ ] Real private object storage, managed KMS, malware scanning, email/delivery, and durable queues probe green.
- [ ] Stripe live mode, webhook secret, allowlisted returns, server price map, replay, and reconciliation verified with provider evidence.
- [ ] Operator IdP/SSO with mandatory MFA, separate cookie/session namespace, reason/ticket, and immutable audit verified.
- [ ] Backup restore, privacy deletion, legal holds, abuse appeal, dead letters, key rotation, and incident runbooks exercised.
- [ ] Staging accessibility tested in a real browser/assistive stack; static checks alone are insufficient.
- [ ] Staging load test meets proposed SLO with representative database/storage/provider latency; local smoke alone is insufficient.
- [ ] All CI gates pass from a clean lockfile; image scans and dependency findings accepted or fixed.
- [ ] Manual production approval completed. Until every item is evidenced, hosted production remains not ready.
