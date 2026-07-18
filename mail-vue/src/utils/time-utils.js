export function sleep(ms) {
	return new Promise(resolve => setTimeout(resolve, ms))
}

export function sleepUntil(ms, signal, {
	setTimeoutFn = globalThis.setTimeout,
	clearTimeoutFn = globalThis.clearTimeout
} = {}) {
	if (signal?.aborted) return Promise.resolve(false)
	return new Promise(resolve => {
		let settled = false
		const finish = completed => {
			if (settled) return
			settled = true
			clearTimeoutFn(timer)
			signal?.removeEventListener('abort', onAbort)
			resolve(completed)
		}
		const onAbort = () => finish(false)
		const timer = setTimeoutFn(() => finish(true), ms)
		signal?.addEventListener('abort', onAbort, { once: true })
	})
}

// 浏览器页面隐藏时暂停轮询，重新可见后立即恢复。
export function waitUntilVisible(signal) {
	if (signal?.aborted) return Promise.resolve(false)
	if (typeof document === 'undefined' || !document.hidden) {
		return Promise.resolve(true)
	}
	return new Promise(resolve => {
		const finish = visible => {
			document.removeEventListener('visibilitychange', onVisible)
			signal?.removeEventListener('abort', onAbort)
			resolve(visible)
		}
		const onVisible = () => {
			if (!document.hidden) {
				finish(true)
			}
		}
		const onAbort = () => finish(false)
		document.addEventListener('visibilitychange', onVisible)
		signal?.addEventListener('abort', onAbort, { once: true })
	})
}
