export async function changePasswordAndSignOut({
  currentPassword,
  newPassword,
  updatePassword,
  clearSession
}) {
  await updatePassword({ currentPassword, newPassword })
  await clearSession()
}
