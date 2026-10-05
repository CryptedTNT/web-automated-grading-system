import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parse } from '@vue/compiler-sfc'
import { parse as parseTemplate } from '@vue/compiler-dom'

const source = readFileSync(new URL('../src/views/UploadView.vue', import.meta.url), 'utf8')
const { descriptor } = parse(source)
const nodes = []
function walk(node) {
  if (node.type === 1) nodes.push(node)
  for (const child of node.children || []) walk(child)
  for (const branch of node.branches || []) walk(branch)
}
walk(parseTemplate(descriptor.template.content))

test('hidden picker inputs cannot bubble clicks into the upload card', () => {
  for (const ref of ['fileInput', 'photoInput', 'folderInput', 'nativeCaptureInput']) {
    const input = nodes.find(node => node.tag === 'input' && node.props.some(prop => prop.name === 'ref' && prop.value?.content === ref))
    assert.ok(input, ref)
    assert.ok(input.props.some(prop => prop.name === 'on' && prop.arg?.content === 'click' && prop.modifiers.some(modifier => (modifier.content || modifier) === 'stop')), `${ref} must stop click propagation`)
  }
})

test('file and directory pickers do not request a photo-only interface', () => {
  for (const ref of ['fileInput', 'folderInput']) {
    const input = nodes.find(node => node.tag === 'input' && node.props.some(prop => prop.name === 'ref' && prop.value?.content === ref))
    assert.ok(!input.props.some(prop => prop.name === 'accept'))
  }
})
