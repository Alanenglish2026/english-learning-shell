export const REVIEW_POLICY_VERSION='review-policy-1';
export const DEFAULT_RETRY_AFTER_MS=15*60*1000;
export function resolveReviewPolicy(activity={}){const local=activity.review_policy||activity.evidence_policy?.review_policy||{};const retry=local.retry_after_ms??DEFAULT_RETRY_AFTER_MS;if(!Number.isInteger(retry)||retry<60_000||retry>30*24*3600_000)throw Error('review retry_after_ms 无效。');return {version:REVIEW_POLICY_VERSION,retry_after_ms:retry};}
