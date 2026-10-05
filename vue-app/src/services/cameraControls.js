/** Browser camera controls must be advertised by the active video track. */
export function cameraCapabilities(track) {
  const caps = track?.getCapabilities?.() || {}
  const modes = Array.isArray(caps.focusMode) ? caps.focusMode : []
  const range = caps.focusDistance
  return {
    torch: caps.torch === true || (Array.isArray(caps.torch) && caps.torch.includes(true)),
    autoFocus: modes.includes('continuous'),
    refocusMode: modes.includes('single-shot') ? 'single-shot' : modes.includes('continuous') ? 'continuous' : null,
    manualFocus: modes.includes('manual') && Number.isFinite(range?.min) && Number.isFinite(range?.max) && range.max > range.min,
    focusMin: range?.min ?? 0,
    focusMax: range?.max ?? 1,
    focusStep: range?.step > 0 ? range.step : 0.01,
  }
}

export async function applyCameraControl(track, values) {
  if (!track || track.readyState === 'ended') throw new Error('The camera is not active.')
  // Preserve resolution, facing mode, and previously enabled controls.
  const current = track.getConstraints?.() || {}
  const advanced = [...(current.advanced || [])]
    .map((entry) => Object.fromEntries(Object.entries(entry).filter(([key]) => !(key in values))))
    .filter((entry) => Object.keys(entry).length)
  await track.applyConstraints({ ...current, advanced: [...advanced, values] })
  // Browsers can silently ignore an unsupported advanced constraint.
  const settings = track.getSettings?.() || {}
  for (const key of ['torch', 'focusMode']) {
    if (key in values && settings[key] !== undefined && settings[key] !== values[key]) {
      throw new Error('The browser could not apply this camera setting.')
    }
  }
  return settings
}
