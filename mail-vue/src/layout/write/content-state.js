export function stageProgrammaticWriterContent({form, defaultValue}, {
  content = '',
  text = ''
}) {
  const snapshot = {
    content: String(content ?? ''),
    text: String(text ?? '')
  }
  form.content = snapshot.content
  form.text = snapshot.text
  defaultValue.value = snapshot.content
  return snapshot
}
