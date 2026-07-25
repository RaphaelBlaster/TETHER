export const THEME_TRANSITION_COOLDOWN_MS = 700

export function themeRevealGeometry(bounds, viewport) {
  const width = Math.max(0, Number(viewport?.width) || 0)
  const height = Math.max(0, Number(viewport?.height) || 0)
  const centerX = Number(bounds?.left) + (Number(bounds?.width) / 2)
  const centerY = Number(bounds?.top) + (Number(bounds?.height) / 2)
  const x = Math.min(width, Math.max(0, Number.isFinite(centerX) ? centerX : 0))
  const y = Math.min(height, Math.max(0, Number.isFinite(centerY) ? centerY : 0))
  const radius = Math.hypot(
    Math.max(x, width - x),
    Math.max(y, height - y),
  )
  return { x, y, radius }
}

export function shouldAnimateThemeTransition({
  active,
  lastStartedAt,
  now,
  cooldownMs = THEME_TRANSITION_COOLDOWN_MS,
}) {
  if (active) return false
  return !Number.isFinite(lastStartedAt) || now - lastStartedAt >= cooldownMs
}
