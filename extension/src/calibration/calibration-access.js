export function permissionPatternForOrigin(origin) {
  const parsed = new URL(origin)
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.origin !== origin) {
    throw new Error('A valid web origin is required')
  }
  return `${parsed.origin}/*`
}

export async function hasCalibrationAccess(
  origin,
  contains = (permissions) => chrome.permissions.contains(permissions),
) {
  return contains({ origins: [permissionPatternForOrigin(origin)] })
}

export async function requestCalibrationAccess(
  origin,
  request = (permissions) => chrome.permissions.request(permissions),
) {
  const granted = await request({ origins: [permissionPatternForOrigin(origin)] })
  if (!granted) throw new Error('Site access was not granted. TETHER cannot calibrate this site without it.')
  return true
}
