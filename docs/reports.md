# Reports

Phase 3 supports weekly reliability, monthly submissions, spam, delivery, incident, and agency-client reports. Each contains summary, metrics, incidents, changes, recommendations, and evidence IDs/links.

Local generation first resolves every evidence ID through a workspace-scoped repository, then writes immutable private JSON, formula-safe CSV, or escaped self-contained HTML. Artifact and canonical evidence-manifest metadata (evidence type/version/hash and manifest hash) are persisted through one repository operation and remain discoverable after service restart. Download requires exact workspace authorization and verifies checksum and expiry. Production generation is unavailable until the PostgreSQL repository and private object storage are wired. PDF returns `pdf_renderer_unavailable` until a real isolated renderer is installed.
