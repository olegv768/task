// Measures the 1,000,000-point run in a real browser with CPU throttling x4
// (same switch as DevTools > Performance > CPU: 4x slowdown), for the naive
// renderer (?naive=1) and the shipped one. Writes perf/results.json and one
// Performance trace per mode that can be opened in DevTools > Performance.
//
//   npm run build && npm run perf
//
// Uses the Edge or Chrome already installed on the machine.

import { mkdirSync, writeFileSync } from 'node:fs'
import { chromium } from 'playwright-core'
import { preview } from 'vite'

const RUNS = 3
const PORT = 4183
const OUT = 'perf'
mkdirSync(OUT, { recursive: true })

const server = await preview({ preview: { port: PORT, strictPort: true } })
const base = `http://localhost:${PORT}`

async function launch() {
  for (const channel of ['msedge', 'chrome']) {
    try {
      return { browser: await chromium.launch({ channel, headless: true }), channel }
    } catch {
      /* try the next one */
    }
  }
  throw new Error('Neither Edge nor Chrome could be started')
}

const median = a => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)]
const max = a => Math.max(...a)
const round = v => Math.round(v * 10) / 10

async function measure(browser, mode, withTrace) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 })
  const page = await context.newPage()
  const cdp = await context.newCDPSession(page)
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 })
  if (withTrace) await browser.startTracing(page, { path: `${OUT}/trace-${mode}.json` })

  const url = `${base}/?latency=0${mode === 'naive' ? '&naive=1' : ''}#/run/run-08`
  await page.goto(url)
  await page.waitForFunction(
    () => ['loss', 'lr', 'grad_norm'].every(m => performance.getEntriesByName(`chart-drawn:${m}`).length > 0),
    null,
    { timeout: 120_000 },
  )
  const firstRender = await page.evaluate(() =>
    Math.max(...['loss', 'lr', 'grad_norm'].map(m => performance.getEntriesByName(`chart-drawn:${m}`)[0].startTime)),
  )

  // time from an input event to the end of the next painted frame
  const interact = await page.evaluate(async () => {
    const el = document.querySelector('.chart-over')
    const r = el.getBoundingClientRect()
    const y = r.top + 100
    const nextFrame = () => new Promise(res => requestAnimationFrame(() => setTimeout(res, 0)))
    await nextFrame()

    const hover = []
    for (let i = 0; i < 20; i++) {
      const x = r.left + 100 + i * 45
      const t0 = performance.now()
      el.dispatchEvent(new PointerEvent('pointermove', { clientX: x, clientY: y, bubbles: true }))
      await nextFrame()
      hover.push(performance.now() - t0)
    }

    const zoom = []
    for (const deltaY of [-100, -100, -100, -100, 100, 100, 100, 100]) {
      const t0 = performance.now()
      el.dispatchEvent(
        new WheelEvent('wheel', { clientX: r.left + 600, clientY: y, deltaY, ctrlKey: true, bubbles: true, cancelable: true }),
      )
      await nextFrame()
      zoom.push(performance.now() - t0)
    }
    return { hover, zoom }
  })

  if (withTrace) await browser.stopTracing()

  await cdp.send('HeapProfiler.enable')
  await cdp.send('HeapProfiler.collectGarbage')
  const heap = await cdp.send('Runtime.getHeapUsage')
  await context.close()

  return {
    firstRenderMs: firstRender,
    hoverMedianMs: median(interact.hover),
    hoverMaxMs: max(interact.hover),
    zoomMedianMs: median(interact.zoom),
    zoomMaxMs: max(interact.zoom),
    jsHeapMB: heap.usedSize / 1048576,
    typedArrayMB: (heap.backingStorageSize ?? 0) / 1048576,
  }
}

const { browser, channel } = await launch()
const results = { browser: `${channel} ${browser.version()}`, cpuThrottling: 4, viewport: '1280x800', run: 'run-08 (1,000,000 points)', runsPerMode: RUNS }

for (const mode of ['naive', 'optimized']) {
  const samples = []
  for (let i = 0; i < RUNS; i++) {
    samples.push(await measure(browser, mode, i === 0))
    console.log(mode, `run ${i + 1}`, JSON.stringify(Object.fromEntries(Object.entries(samples[i]).map(([k, v]) => [k, round(v)]))))
  }
  results[mode] = Object.fromEntries(Object.keys(samples[0]).map(k => [k, round(median(samples.map(s => s[k])))]))
  results[mode + 'Samples'] = samples.map(s => Object.fromEntries(Object.entries(s).map(([k, v]) => [k, round(v)])))
}

await browser.close()
await new Promise(res => server.httpServer.close(res))

writeFileSync(`${OUT}/results.json`, JSON.stringify(results, null, 2) + '\n')

console.log(`\n${results.browser}, CPU throttling x4, ${results.viewport}, median of ${RUNS} cold loads\n`)
console.log('metric'.padEnd(34), 'naive'.padStart(10), 'optimized'.padStart(10))
for (const k of Object.keys(results.naive)) {
  console.log(k.padEnd(34), String(results.naive[k]).padStart(10), String(results.optimized[k]).padStart(10))
}
console.log('\nhover/zoom = input event -> end of next painted frame, so ~17 ms is the floor at 60 Hz.')
process.exit(0)
