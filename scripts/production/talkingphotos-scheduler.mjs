export function availableSubmissionCapacity({ remoteCount, remoteLimit, localActiveCount }) {
  const limit = Number(remoteLimit)
  const remote = Number(remoteCount)
  const local = Number(localActiveCount)
  if (!Number.isFinite(limit) || limit <= 0) return 0

  const observedActive = Math.max(
    Number.isFinite(remote) ? remote : 0,
    Number.isFinite(local) ? local : 0
  )
  return Math.max(0, Math.floor(limit - observedActive))
}
