import assert from 'node:assert/strict'
import test from 'node:test'
import { createHash } from 'node:crypto'
import { DRAFT_DB_PREFIX, hashDraftIdentity } from '../src/db/draft-identity.js'

function referenceName(normalizedIdentity) {
  const hex = createHash('sha256').update(normalizedIdentity, 'utf8').digest('hex')
  return DRAFT_DB_PREFIX + hex.slice(0, 32)
}

test('hashed draft database names hide the plaintext email', async () => {
  const name = await hashDraftIdentity('user@example.com')

  assert.ok(name.startsWith(DRAFT_DB_PREFIX))
  assert.equal(name.length, DRAFT_DB_PREFIX.length + 32)
  assert.match(name.slice(DRAFT_DB_PREFIX.length), /^[0-9a-f]{32}$/)
  assert.ok(!name.includes('user@example.com'))
})

test('hashing matches an independent SHA-256 reference', async () => {
  assert.equal(await hashDraftIdentity('user@example.com'), referenceName('user@example.com'))
})

test('identity normalization ignores case and surrounding whitespace', async () => {
  const canonical = await hashDraftIdentity('user@example.com')

  assert.equal(await hashDraftIdentity('  User@Example.COM  '), canonical)
  assert.equal(await hashDraftIdentity('USER@EXAMPLE.COM'), canonical)
})

test('different accounts map to different database names', async () => {
  const first = await hashDraftIdentity('a@example.com')
  const second = await hashDraftIdentity('b@example.com')

  assert.notEqual(first, second)
})
