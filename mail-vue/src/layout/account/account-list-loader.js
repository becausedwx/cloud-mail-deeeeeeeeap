export async function loadAccountPage({ request, isCurrent = () => true, onSuccess, onError }) {
  try {
    const list = await request()
    if (!isCurrent()) return { applied: false, stale: true }
    onSuccess?.(list)
    return { applied: true, stale: false }
  } catch (error) {
    const current = isCurrent()
    if (current) onError?.(error)
    return { applied: false, stale: !current, error }
  }
}
