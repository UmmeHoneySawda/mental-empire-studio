// Pure URL guards shared between the main process and tests.

/** True only for http(s) URLs. Used to gate shell.openExternal so a stray/attacker
 *  string can't launch arbitrary protocols (file:, smb:, custom handlers). */
export function isAllowedExternalUrl(url: string): boolean {
  return /^https?:\/\//i.test(url)
}
