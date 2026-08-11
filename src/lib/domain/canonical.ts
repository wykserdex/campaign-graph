import { createHmac } from "crypto";

// ═══════════════════════════════════════════════════════════════════════════
// Canonical key normalization functions
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Normalize a domain to its registrable form:
 * - lowercase
 * - strip www.
 * - strip trailing dots
 * - IDN → punycode via URL API
 */
export function normalizeRegistrableDomain(input: string): string {
  let domain = input.trim().toLowerCase();
  if (domain.includes("://")) {
    try {
      domain = new URL(domain).hostname;
    } catch {
      // fall through
    }
  }
  if (domain.startsWith("www.")) {
    domain = domain.slice(4);
  }
  domain = domain.replace(/\.+$/, "");
  try {
    const encoded = new URL(`http://${domain}`).hostname;
    if (encoded) domain = encoded;
  } catch {
    // fall through
  }
  return domain;
}

/** Canonical key for Repository: provider:owner/repo */
export function canonicalRepository(
  provider: string,
  owner: string,
  repo: string
): string {
  return `${provider.toLowerCase()}:${owner}/${repo}`;
}

/** Canonical key for Commit: provider:owner/repo:sha */
export function canonicalCommit(
  provider: string,
  owner: string,
  repo: string,
  sha: string
): string {
  return `${provider.toLowerCase()}:${owner}/${repo}:${sha}`;
}

/**
 * Canonical key for SecretFingerprint: hmac:secret:keyVersion:digest
 * IMPORTANT: purpose must always be 'secret' — never reuse as SubjectIndex
 */
export function canonicalSecretFingerprint(
  keyVersion: string,
  digest: string
): string {
  return `hmac:secret:${keyVersion}:${digest}`;
}

/**
 * Canonical key for SubjectIndex: hmac:v3:digest
 * IMPORTANT: different purpose from SecretFingerprint
 */
export function canonicalSubjectIndex(digest: string): string {
  return `hmac:v3:${digest}`;
}

/** Canonical key for PhishingURL: sha256:digest */
export function canonicalPhishingURL(rawUrl: string): string {
  const canonUrl = canonicalizeUrl(rawUrl);
  const digest = createHmac("sha256", "campaign-graph-url")
    .update(canonUrl)
    .digest("hex");
  return `sha256:${digest}`;
}

/** Canonical key for Domain */
export function canonicalDomain(input: string): string {
  return normalizeRegistrableDomain(input);
}

/** Canonical key for LeakIncident: sourceSystem:sourceRecordId */
export function canonicalLeakIncident(
  sourceSystem: string,
  sourceRecordId: string
): string {
  return `${sourceSystem}:${sourceRecordId}`;
}

/** Canonical key for Actor: platform:authorId */
export function canonicalActor(
  sourcePlatform: string,
  authorId: string
): string {
  return `${sourcePlatform.toLowerCase()}:${authorId}`;
}

/** URL canonicalization — sort params, lowercase scheme+host */
function canonicalizeUrl(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    url.searchParams.sort();
    return `${url.protocol.toLowerCase()}//${url.hostname.toLowerCase()}${url.port ? ":" + url.port : ""}${url.pathname}${url.search}${url.hash}`;
  } catch {
    return rawUrl.trim().toLowerCase();
  }
}
