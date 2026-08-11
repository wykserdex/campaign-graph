// ═══════════════════════════════════════════════════════════════════════════
// Seed Data — sample events for testing
// ═══════════════════════════════════════════════════════════════════════════

export const sampleSecretExposure = {
  event_id: "evt-se-001",
  event_type: "SecretExposureDetected",
  tenant_id: "00000000-0000-0000-0000-000000000001",
  repository_id: "repo-acme-web",
  repository_provider: "github",
  repository_owner: "acme-corp",
  repository_name: "web-app",
  commit_sha: "abc123def456",
  secret_type: "aws_access_key",
  fingerprint: "fp-uuid-001",
  key_version: "v1",
  finding_confidence: 0.95,
};

export const sampleLeakObserved = {
  event_id: "evt-li-001",
  event_type: "ExposureObserved",
  tenant_id: "00000000-0000-0000-0000-000000000001",
  source_id: "leak-intelligence",
  source_record_id: "rec-li-001",
  incident_name: "Acme Corp data leak on pastebin",
  subject_indexes: [
    { digest: "hmac-subj-001", type: "email" },
    { digest: "hmac-subj-002", type: "phone" },
  ],
};

export const sampleUntilPhish = {
  event_id: "evt-up-001",
  event_type: "PhishingDetected",
  url: "https://acme-login.evil-phish.com/verify",
  domain: "evil-phish.com",
  verdict: "malicious",
  source_platform: "untilphish",
  author_id: "actor-001",
  author_handle: "phisher_king",
};

export const sampleUntilPhish2 = {
  event_id: "evt-up-002",
  event_type: "PhishingDetected",
  url: "https://acme-support.evil-phish.com/reset",
  domain: "evil-phish.com",
  verdict: "malicious",
  source_platform: "untilphish",
  author_id: "actor-001",
  author_handle: "phisher_king",
};
