/** Convert an unknown rejection into concise user-facing copy without ever
 * rendering "undefined", "[object Object]", or an empty alert. */
export function errorMessage(error: unknown, fallback = 'Something went wrong. Try again.'): string {
  if (error instanceof Error && error.message.trim()) return error.message.trim()
  if (typeof error === 'string' && error.trim()) return error.trim()
  return fallback
}
