import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { parse } = require('vue/compiler-sfc')

const componentPath = fileURLToPath(
    new URL('../src/components/email-scroll/index.vue', import.meta.url)
)

function collectMemoElements(node, found = []) {
  const directives = node.props?.filter(prop => prop.type === 7) ?? []
  if (directives.some(directive => directive.name === 'memo')) {
    found.push({
      tag: node.tag,
      hasFor: directives.some(directive => directive.name === 'for')
    })
  }
  for (const child of node.children ?? []) {
    if (typeof child === 'object' && child !== null) {
      collectMemoElements(child, found)
    }
  }
  return found
}

// v-memo 只有挂在 v-for 元素上时，编译器才会按下标分配缓存并校验 key。
// 挂在插槽里的普通元素上时 _cache 下标是编译期常量，一次渲染中所有行共用
// 同一个槽，withMemo 命中后会把同一个 vnode 对象返回给多行，列表塌成重复行。
test('email-scroll rows never use v-memo outside v-for', () => {
  const { descriptor, errors } = parse(readFileSync(componentPath, 'utf8'), {
    filename: 'email-scroll/index.vue'
  })

  assert.deepEqual(errors, [], 'component template must parse cleanly')
  assert.ok(descriptor.template, 'component must have a template block')

  const memoElements = collectMemoElements(descriptor.template.ast)
  const unsafe = memoElements.filter(element => !element.hasFor)

  assert.deepEqual(
      unsafe,
      [],
      `v-memo without v-for shares one render-cache slot across every row: ${JSON.stringify(unsafe)}`
  )
})
