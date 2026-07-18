(() => {
  try {
    const storedUi = localStorage.getItem('ui')
    if (!storedUi) return

    const ui = JSON.parse(storedUi)
    const dark = ui?.dark === true
    const root = document.documentElement
    root.setAttribute('class', dark ? 'dark' : '')

    const themeColor = document.getElementById('theme-color-meta')
    if (!themeColor) return

    const isMobile = !window.matchMedia('(pointer: fine) and (hover: hover)').matches
    themeColor.setAttribute(
      'content',
      dark
        ? (isMobile ? '#141414' : '#000000')
        : (isMobile ? '#FFFFFF' : '#F1F1F1')
    )
  } catch {
    // A malformed non-sensitive UI preference must not block application startup.
  }
})()
