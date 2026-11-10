# Note

## Verdict: DON'T SHIP yet

The chart I would trust. The page around it I would not give to someone about to stop a $500 run. Fix first:

1. **It shows a snapshot, not the run.** No live updates. A running run is flagged "may be out of date" after 60 s,
   but the decision can still be made on stale data. Poll or stream, and show the age of the last point.
2. **What a person sees is not under test.** Tests check the points handed to the canvas, not the pixels. Three of
   the bugs below were found by looking at the screen while every test was green.

## 1. Truthfulness

1M points become one bucket per pixel column holding min, max, first, last and counts of what cannot be drawn.
Nothing is averaged, so a one-point spike is the max of its column at any zoom. Lost: the order of points inside a
column. The readout says so ("960 points in this pixel: min 0.236, max 48").

39 tests, all pass (`test-output.txt`):

- **Spike**: 175 combinations of width × zoom × position reach the exact pixel of the value 48. Controls show
  "every Nth point" and per-pixel averaging both lose it.
- **NaN / ±Inf**: no y position, line breaks, red mark, counted. A run ending in NaN shows "Loss now: NaN".
- **Duplicates / unsorted**: sorted, last written wins, compared with a dumb Map + sort reference for all 20 runs.
- **Gaps**: line breaks, no interpolation.
- **Numbers and labels**: bucket min/max vs brute force on 200 random windows; cards vs the reference; every tick
  label parses back to its value.

The first 35 passed on the first run, which proves little, so three bugs were put in on purpose (NaN as a number,
last instead of max, gaps not breaking the line): 5, 2 and 1 tests failed.

**Tests would not catch**: wrong canvas drawing (clipping, pixel ratio, anti-aliasing), contrast, a chart wired to
the wrong metric, a spike that is drawn but not *noticed*, data shapes outside my 20 runs.

## 2. Performance

`npm run perf`: Edge 157 headless, CPU ×4, 1280×800, run-08 (1M points), median of 3 cold loads. Traces in `perf/`.

| | before (naive) | after |
| --- | ---: | ---: |
| First render, three charts | 4074 ms | 1553 ms |
| Hover → next frame, median / worst | 2872 / 6123 ms | 17 / 42 ms |
| Zoom → next frame, median / worst | 773 / 3173 ms | 74 / 233 ms |
| JS heap + typed arrays | 80 MB | 35 MB |

"Before" is not an earlier version: it is a baseline written for the comparison (`?naive=1`), one object and one
`lineTo` per point, full redraw on hover. Not good enough yet: zooming out to the full range takes 233 ms (all rows
rescanned; a min/max pyramid would fix it). Hover and zoom use synthetic events, so 17 ms is the frame floor. Memory
is heap, not the whole tab.

## 3. Silent failures

| Looks fine, is wrong | What the app does | How it was checked |
| --- | --- | --- |
| Stale data | Fetch time in UTC; warning after 60 s; "running" but silent 30 min is flagged | Unit tests. **Not solved**: no auto-refresh |
| Race on quick switching | Only the newest request may answer; older ones aborted | 4 tests; in the browser: slow run then fast run, page ended on the fast one |
| Locale / time zone | Numbers always `en-US`, times always UTC | Tests. Not tried in a non-English browser |
| Smoothing hides divergence | Raw stays under the smoothed line; y axis follows raw | Test on run-17, and by eye (section 4) |
| Log scale with zeros | Values ≤ 0 counted and marked at the bottom | Test on run-13 |
| NaN in a sorted column | NaN always last | Test plus a control |

## 4. AI tools and my own part

**AI coding assistant** (one session, from the task PDF): the application, downsampling, handling of bad data, the
tests, the optimisations, the measurement script and its run, the first draft of this note. Accepted as proposed:
min/max approach, test design, verdict. It also read my outputs and traces, made the fixes below, and put section 5
into English from what happened to me in this work.

**Me:**

- Ran it locally and went through the list of all 20 runs. From that output: the empty run showed "Last logged:
  16 s ago" for something that never happened. Fixed ("never").
- Broke the downsampling by hand (`max[b] = v`) to see if the tests notice. Two attempts told me nothing: the site
  looked the same and `npm test` said 35 passed. I had edited a different copy from the one I was running, and the
  run list does not use that code. Third attempt: `2 failed`, `expected 0.2465 to be 48`. "I changed it and it
  still looks right" is not evidence until I know the change was live.
- Smoothing 0.99 on run-08: the chart "dropped to the bottom". The spike was still drawn, but at 38% opacity, one
  pixel wide. Tests were green. Fixed: raw keeps full colour, the smoothed line is black. No test for it.
- Log scale on run-13: the axis was labelled 1, 2, 3, 4 while the run sits at 0.3–0.5, so half the chart had no
  label. Fixed (0.5, 1, 2), with a test.
- "Only runs with data problems" filter: it hides run-20, flagged "silent" in the full list, and says nothing about
  run-17 (diverging) or run-08 (spike). It finds broken data, not broken training. **Not fixed.**
- My own DevTools trace, CPU ×4 (`perf/trace-list-devtools.json.gz`). I recorded the run list, not run-08, so it
  does not confirm the table above. It shows what the script never measured: a 1,135 ms task that freezes the list
  page, about 730 ms of it generating all 20 runs to fill the columns.

- Reviewed the data code (`downsample`, `normalize`, `ema`, the draw list, zoom) and wrote up 9 remarks. The
  assistant ran each one. Two were real and are fixed with tests: de-duplication was quadratic (80,000 rows with
  one step took 4.2 s, now 16 ms), and columns of different length were silently padded with NaN. One I called
  critical was wrong: the first-min-max-last order inside a column cannot invent a trajectory, because all four
  points share one x. One is a real limit, kept and pinned by a test: a NaN between two values inside one pixel
  column cannot break the line; it is only flagged red.

**Not done by me:** a trace of run-08 itself, a review of the UI components, a non-English locale check.

## 5. What surprised me, what still concerns me

Three things surprised me. First, how easy it was to believe a check that checked nothing: green tests, and my own
break-it test "passing" because I edited one copy and ran another. Second, one screen disagreeing with itself: with
smoothing on, the readout under the chart said `max 48` while the picture above it showed a flat line at the
bottom. The number was honest and the drawing was not, and a person in a hurry reads the drawing. Third, my most
useful measurement was a mistake: I recorded the wrong page and found a one-second freeze on the run list that the
careful script had never looked at. What still concerns me: every real bug in section 4 was found by looking at
the screen, which is exactly what the tests do not cover, and I only looked at a few of the 20 runs that closely.
