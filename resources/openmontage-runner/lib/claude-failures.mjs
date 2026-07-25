/**
 * Claude Code failure classification.
 *
 * Kept in its own side-effect-free module so both the runner and its tests can
 * import it without executing the runner's CLI entrypoint.
 *
 * The retryable flag matters: MES spends its retry budget on anything marked
 * retryable, so authentication and quota problems must be non-retryable. No
 * number of retries produces a login or restores capacity, and burning the budget
 * on them delays the MES fallback that would actually have produced a video.
 */
export function classifyFailureText(text) {
  const haystack = String(text ?? '').toLowerCase()
  if (/not logged in|please run \/login|invalid api key|authentication_error|unauthorized|oauth/.test(haystack)) {
    return { code: 'CLAUDE_NOT_AUTHENTICATED', retryable: false }
  }
  if (/usage limit|rate limit|quota|out of credits|insufficient_quota|too many requests|429/.test(haystack)) {
    return { code: 'CLAUDE_USAGE_LIMIT_REACHED', retryable: false }
  }
  if (/permission denied|not permitted|permission_denials|refused to run|blocked by hook/.test(haystack)) {
    return { code: 'CLAUDE_PERMISSION_DENIED', retryable: false }
  }
  if (/econnreset|etimedout|enotfound|socket hang up|network|fetch failed|502|503|504/.test(haystack)) {
    return { code: 'CLAUDE_NETWORK_FAILED', retryable: true }
  }
  if (/max turns|max_turns/.test(haystack)) {
    return { code: 'CLAUDE_MAX_TURNS_REACHED', retryable: true }
  }
  return { code: 'CLAUDE_EXEC_FAILED', retryable: true }
}
