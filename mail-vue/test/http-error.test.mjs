import assert from 'node:assert/strict'
import test from 'node:test'
import axios from 'axios'
import { classifyHttpError, isCurrentSessionResponse } from '../src/axios/response-error.js'

// 我们自己发起的取消（刷新时作废后台预取、hover 预取失效、切账号）不是故障。
// CanceledError 既没有 response，message 也不含 'Network Error'，一旦漏判就会掉进
// 兜底分支弹出「请求失败，请稍后再试」——刷新几次就报错的真实原因。
test('a request we cancelled ourselves is not an error worth reporting', async () => {
  const controller = new AbortController()
  controller.abort()

  // 预先 abort 的 signal 让 axios 立刻拒绝，不产生任何网络访问，
  // 拿到的就是运行时真正会交给拦截器的那个错误对象
  const error = await axios
      .get('http://127.0.0.1:1/never', { signal: controller.signal, timeout: 1000 })
      .then(() => null, e => e)

  assert.ok(error, 'an aborted request must reject')
  assert.equal(error.response, undefined, 'a cancelled request never carries a response')
  assert.deepEqual(classifyHttpError(error), { kind: 'canceled', payload: null })
})

test('a genuine transport failure is still reported', () => {
  const networkError = Object.assign(new Error('Network Error'), { code: 'ERR_NETWORK' })

  assert.equal(classifyHttpError(networkError).kind, 'other')
})

test('classifies real HTTP authentication failures from the API payload', () => {
  assert.deepEqual(classifyHttpError({
    response: {
      status: 401,
      data: { code: 401, message: 'expired' }
    }
  }), {
    kind: 'unauthorized',
    payload: { code: 401, message: 'expired' }
  })

  assert.deepEqual(classifyHttpError({
    response: {
      status: 403,
      data: { code: 403, message: 'forbidden' }
    }
  }), {
    kind: 'forbidden',
    payload: { code: 403, message: 'forbidden' }
  })
})

test('keeps a non-JSON edge 403 distinct from an API permission failure', () => {
  assert.deepEqual(classifyHttpError({
    response: { status: 403, data: '<html>challenge</html>' }
  }), {
    kind: 'edge-forbidden',
    payload: null
  })
})

test('does not let an old account response invalidate a newer session', () => {
  assert.equal(isCurrentSessionResponse(4, 5), false)
  assert.equal(isCurrentSessionResponse(5, 5), true)
  assert.equal(isCurrentSessionResponse(undefined, 5), true)
})
