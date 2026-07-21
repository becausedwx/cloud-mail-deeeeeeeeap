import assert from 'node:assert/strict'
import test from 'node:test'
import { changePasswordAndSignOut } from '../src/views/setting/password-change.js'

test('a successful password change sends distinct credentials before signing out', async () => {
  const events = []

  await changePasswordAndSignOut({
    currentPassword: 'current-password',
    newPassword: 'new-password',
    updatePassword: async payload => events.push(['update', payload]),
    clearSession: async () => events.push(['clear'])
  })

  assert.deepEqual(events, [
    ['update', {
      currentPassword: 'current-password',
      newPassword: 'new-password'
    }],
    ['clear']
  ])
})

test('a failed password change preserves the current session', async () => {
  const failure = new Error('current password rejected')
  let clearCount = 0

  await assert.rejects(changePasswordAndSignOut({
    currentPassword: 'wrong-password',
    newPassword: 'new-password',
    updatePassword: async () => {
      throw failure
    },
    clearSession: async () => {
      clearCount++
    }
  }), error => error === failure)

  assert.equal(clearCount, 0)
})
