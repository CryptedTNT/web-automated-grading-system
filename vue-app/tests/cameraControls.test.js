import test from 'node:test'
import assert from 'node:assert/strict'
import { cameraCapabilities, applyCameraControl } from '../src/services/cameraControls.js'

test('unsupported camera controls are not advertised', () => {
  const controls = cameraCapabilities({})
  assert.equal(controls.torch, false)
  assert.equal(controls.refocusMode, null)
  assert.equal(controls.manualFocus, false)
})

test('detects torch, automatic and manual focus, preferring single-shot refocus', () => {
  const controls = cameraCapabilities({ getCapabilities: () => ({
    torch: [false, true], focusMode: ['manual', 'continuous', 'single-shot'],
    focusDistance: { min: 0, max: 10, step: 0.1 },
  }) })
  assert.equal(controls.torch, true)
  assert.equal(controls.autoFocus, true)
  assert.equal(controls.refocusMode, 'single-shot')
  assert.equal(controls.manualFocus, true)
  assert.equal(controls.focusStep, 0.1)
})

test('flash changes preserve focus, resolution, and facing mode', async () => {
  let requested
  const track = {
    readyState: 'live',
    getConstraints: () => ({ width: { ideal: 1920 }, facingMode: 'environment', advanced: [{ torch: false, focusMode: 'continuous' }] }),
    applyConstraints: async (values) => { requested = values },
    getSettings: () => ({ torch: true }),
  }
  await applyCameraControl(track, { torch: true })
  assert.deepEqual(requested.advanced, [{ focusMode: 'continuous' }, { torch: true }])
  assert.deepEqual(requested.width, { ideal: 1920 })
  assert.equal(requested.facingMode, 'environment')
})

test('manual focusing preserves an enabled flashlight', async () => {
  let requested
  await applyCameraControl({
    readyState: 'live',
    getConstraints: () => ({ advanced: [{ torch: true }, { focusMode: 'continuous' }] }),
    applyConstraints: async (values) => { requested = values },
    getSettings: () => ({ focusMode: 'manual' }),
  }, { focusMode: 'manual', focusDistance: 2 })
  assert.deepEqual(requested.advanced, [{ torch: true }, { focusMode: 'manual', focusDistance: 2 }])
})

test('rejects ended tracks and settings the browser silently ignored', async () => {
  await assert.rejects(applyCameraControl({ readyState: 'ended' }, { torch: true }))
  await assert.rejects(applyCameraControl({
    readyState: 'live', applyConstraints: async () => {}, getSettings: () => ({ torch: false }),
  }, { torch: true }))
})
