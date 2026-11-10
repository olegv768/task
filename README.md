# Run monitor

Take-home task for the Soup internship (Frontend Engineer): a monitor for 20 training runs, built to answer one
question — can this chart be shown to someone deciding whether to stop a $500 run?

- Deployed: https://task-eight-pied.vercel.app
- Repository: https://github.com/olegv768/task
- Note (truthfulness, performance, silent failures, verdict, AI use): [NOTE.md](NOTE.md)
- Test output: [test-output.txt](test-output.txt)
- Performance numbers and traces: [perf/](perf/)

## Run it

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # 36 tests, about 3 s
npm run build
npm run perf       # needs Edge or Chrome installed; rewrites perf/
```

No keys, no backend. All data is generated in the browser from fixed seeds (`src/data/generate.ts`), so the tests and
the site look at the same numbers.

## What is where

| Path | What |
| --- | --- |
| `src/data/generate.ts` | The 20 runs and what is broken in each |
| `src/data/api.ts` | Fake backend: async, different latency per run, abortable, one run fails |
| `src/lib/series.ts` | Sort, de-duplicate, find gaps, summary numbers, smoothing |
| `src/lib/downsample.ts` | One min/max bucket per pixel column |
| `src/lib/model.ts` | Everything the chart draws, as plain numbers (this is what the tests check) |
| `src/lib/latest.ts` | "Only the newest request may answer" + staleness rules |
| `src/components/` | Run list, run page, canvas chart, the naive renderer used as the "before" |
| `tests/` | `truth.test.ts` (part 2 of the task), `silent.test.ts` (part 4) |
| `scripts/perf.mjs` | Performance measurement with CPU throttling ×4 |

## Runs worth opening

- `run-05` loss turns NaN and the job keeps running ($500)
- `run-08` 1,000,000 points, one spike at step 500,000 (`?naive=1#/run/run-08` shows the unoptimized renderer)
- `run-10` duplicated steps after a resume · `run-11` unsorted · `run-12` gaps
- `run-13` zeros in loss, try log scale · `run-17` turn smoothing up
- `run-14` error state · `run-15` empty state · `run-20` "running" but silent for hours

URL switches: `?naive=1` (baseline renderer), `?latency=0` (no artificial delay), `?fail=list` (run list fails).
