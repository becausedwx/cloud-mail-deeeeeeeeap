import assert from 'node:assert/strict'
import test from 'node:test'
import { createChartRuntime } from '../src/views/analysis/chart-runtime.js'

test('chart updates reuse instances while resize is batched', () => {
  const charts = []
  const frames = new Map()
  const observers = []
  let nextFrame = 0
  const runtime = createChartRuntime({
    createChart: element => {
      const chart = {
        element,
        options: [],
        resizeCalls: 0,
        disposeCalls: 0,
        setOption(option) { this.options.push(option) },
        resize() { this.resizeCalls++ },
        dispose() { this.disposeCalls++ }
      }
      charts.push(chart)
      return chart
    },
    ResizeObserverClass: class {
      constructor(callback) {
        this.callback = callback
        this.targets = []
        observers.push(this)
      }
      observe(target) { this.targets.push(target) }
      disconnect() { this.targets = [] }
    },
    requestAnimationFrameFn: callback => {
      const id = ++nextFrame
      frames.set(id, callback)
      return id
    },
    cancelAnimationFrameFn: id => frames.delete(id)
  })
  const element = { clientWidth: 400, clientHeight: 200 }

  runtime.activate([element])
  assert.equal(runtime.setOption('sender', element, {value: 1}, 1), true)
  assert.equal(runtime.setOption('sender', element, {value: 1}, 1), false)
  assert.equal(runtime.setOption('sender', element, {value: 2}, 2), true)
  assert.equal(charts.length, 1)
  assert.equal(charts[0].options.length, 2)

  observers[0].callback([{target: element}])
  observers[0].callback([{target: element}])
  assert.equal(frames.size, 1)
  frames.values().next().value()
  assert.equal(charts[0].resizeCalls, 1)
})

test('KeepAlive deactivation cancels work and unmount disposes each chart once', () => {
  const frames = new Map()
  const charts = []
  let nextFrame = 0
  let disconnects = 0
  const runtime = createChartRuntime({
    createChart: () => {
      const chart = {
        resizeCalls: 0,
        disposeCalls: 0,
        setOption() {},
        resize() { this.resizeCalls++ },
        dispose() { this.disposeCalls++ }
      }
      charts.push(chart)
      return chart
    },
    ResizeObserverClass: class {
      constructor(callback) { this.callback = callback }
      observe() {}
      disconnect() { disconnects++ }
    },
    requestAnimationFrameFn: callback => {
      const id = ++nextFrame
      frames.set(id, callback)
      return id
    },
    cancelAnimationFrameFn: id => frames.delete(id)
  })
  const visible = { clientWidth: 320, clientHeight: 180 }
  const hidden = { clientWidth: 0, clientHeight: 0 }

  runtime.setOption('visible', visible, {}, 1)
  runtime.setOption('hidden', hidden, {}, 1)
  assert.equal(runtime.activate([visible, hidden]), true)
  assert.equal(runtime.activate([visible, hidden]), false)
  assert.equal(frames.size, 1)
  assert.equal(runtime.deactivate(), true)
  assert.equal(frames.size, 0)
  assert.equal(disconnects, 1)

  runtime.activate([visible, hidden])
  frames.values().next().value()
  assert.equal(charts[0].resizeCalls, 1)
  assert.equal(charts[1].resizeCalls, 0)

  runtime.dispose()
  assert.deepEqual(charts.map(chart => chart.disposeCalls), [1, 1])
  assert.deepEqual(runtime.stats(), {active: false, charts: 0, observed: 0, frame: 0})
})
