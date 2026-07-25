/**
 * Grok Build CLI failure classification.
 *
 * Side-effect-free so both the runner and its tests can import it without
 * executing the runner's CLI entrypoint.
 *
 * Authentication and quota problems must be non-retryable: MES spends its
 * retry budget on anything marked retryable, and no number of retries produces
 * a login or restores capacity.
 */
export function classifyFailureText(text) {
  const haystack = String(text ?? '').toLowerCase()
  if (
    /not (logged|signed) in|please (run|use) (\/)?login|unauthori[sz]ed|authentication|invalid api key|oauth|login required|not authenticated/.test(
      haystack
    )
  ) {
    return { code: 'GROK_NOT_AUTHENTICATED', retryable: false }
  }
  if (
    /usage limit|rate limit|quota|out of credits|insufficient_quota|too many requests|429|session limit|capacity exhausted|billing/.test(
      haystack
    )
  ) {
    return { code: 'GROK_USAGE_LIMIT_REACHED', retryable: false }
  }
  if (/permission denied|not permitted|blocked by|sandbox|refused to run|access denied/.test(haystack)) {
    return { code: 'GROK_PERMISSION_DENIED', retryable: false }
  }
  if (/econnreset|etimedout|enotfound|socket hang up|network|fetch failed|502|503|504|dns|websocket/.test(haystack)) {
    return { code: 'GROK_NETWORK_FAILED', retryable: true }
  }
  if (/max turns|max_turns|maximum number of agent turns/.test(haystack)) {
    return { code: 'GROK_MAX_TURNS_REACHED', retryable: true }
  }
  if (/process (killed|terminated)|sigterm|sigkill|taskkill|exit code 1/.test(haystack) && /cancel|interrupt/.test(haystack)) {
    return { code: 'GROK_PROCESS_INTERRUPTED', retryable: true }
  }
  return { code: 'GROK_EXEC_FAILED', retryable: true }
}
