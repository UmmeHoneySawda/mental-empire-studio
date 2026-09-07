const minimumBytesPerSecond = 1024
const absoluteMinimumBytes = 4096

export function isValidMediaMetadata(metadata, expectedDurationSec, toleranceSec = 2) {
  const sizeBytes = Number(metadata?.sizeBytes)
  const durationSec = Number(metadata?.durationSec)
  const expected = Number(expectedDurationSec)
  const tolerance = Number(toleranceSec)

  if (!Number.isFinite(sizeBytes) || !Number.isFinite(durationSec)) return false
  if (!Number.isFinite(expected) || expected <= 0) return false
  if (!Number.isFinite(tolerance) || tolerance < 0) return false

  const minimumSize = Math.max(absoluteMinimumBytes, expected * minimumBytesPerSecond)
  return sizeBytes >= minimumSize && Math.abs(durationSec - expected) <= tolerance
}
