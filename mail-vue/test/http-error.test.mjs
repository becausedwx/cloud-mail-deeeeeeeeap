import assert from 'node:assert/strict'
import test from 'node:test'
import { classifyHttpError, isCurrentSessionResponse } from '../src/axios/response-error.js'

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
