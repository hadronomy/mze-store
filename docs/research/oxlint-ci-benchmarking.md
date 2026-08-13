# Oxlint CI benchmark review

- **Date:** 2026-08-13
- **Branch:** `t3code/review-tooling-dx`
- **Pull request:** [#86](https://github.com/hadronomy/mze-store/pull/86)
- **Scope:** Review the visitor benchmark and its use as a blocking CI certification test.

**Implementation:** Applied on this branch. Timing now runs in
`tooling/oxlint/test/visitor.bench.ts` and reports through a non-blocking CI
job. The required certification suite and baseline report contain deterministic
checks only.

## Decision

The former timing assertion was not a sound blocking CI gate.

The former benchmark had a reasonable first measurement shape. It warmed the
code, ran many callbacks per sample, measured process CPU time, and used a
median. The fixed limits were not portable across GitHub-hosted machines. They
failed on this pull request while the deterministic certification tests passed.

The contract, lifecycle, version, diagnostic, fix, and idempotence tests remain
blocking. Timing now runs in a separate benchmark job. A blocking performance
gate needs noise data and a same-runner comparison of the base and pull request
builds.

## What the failing branch measured

[`certification.test.ts`](https://github.com/hadronomy/mze-store/blob/31101c0352fe916bd83998b52a436029ab2a2a2d/tooling/oxlint/test/certification.test.ts)
used these settings before this implementation:

- 1,000 warm-up callbacks.
- Five samples.
- 10,000 callbacks per sample.
- `process.cpuUsage()` for user and system CPU time.
- The median sample as the reported value.
- An absolute limit of 1 ms for `Visitor.onSync`.
- An absolute limit of 25 ms for `Visitor.onEffect`.

The timing assertion ran as a regular test in the full `vp test` command. It did
not use a dedicated benchmark runner. It did not record spread, outliers,
confidence, or relative change.

The production rule uses only the direct visitor path. The rule source creates
`Visitor.onSync` visitors for its module-reference cases and has no
`Visitor.onEffect` visitor. The effectful path appears in certification and
baseline tests. The former gate therefore blocked the pull request on a
synthetic escape-hatch path that production does not use.

The [Oxlint authoring guide](https://oxc.rs/docs/guide/usage/linter/writing-js-plugins.html)
describes `createOnce` as an alternative API intended for performance
optimizations. It also states that the alternative API is not faster in the
current release. Its future optimization value does not define a portable
millisecond SLA for an Effect runtime.

## CI evidence

The [latest failed CI run](https://github.com/hadronomy/mze-store/actions/runs/31704137365/job/94460298380)
failed only the effectful timing assertion. GitHub Actions measured a median of
`59.046 ms` against the `25 ms` limit. The direct assertion and the other 94
tests passed.

The [previous run](https://github.com/hadronomy/mze-store/actions/runs/31701699304)
also failed the same assertion. It measured `55.698868 ms` against `25 ms`
before the timer changed from elapsed time to CPU time. Both CI results were
more than twice the selected limit. Local pinned Node 24 and Apple M4 runs
recorded about 10.7–13.6 ms. The pre-change README recorded about 7 ms on an M4.

The workflow uses `ubuntu-latest` for the blocking checks. GitHub documents
`ubuntu-latest` as a fresh hosted VM with four x64 CPUs for public repositories,
and documents that `-latest` images can change over time. See the [GitHub-hosted
runner reference](https://docs.github.com/en/actions/reference/runners/github-hosted-runners).
The documented CPU count does not identify a fixed CPU model, frequency,
thermal state, or host load. Those differences can change a microbenchmark's
absolute CPU cost.

## What the timers mean

Node documents `process.cpuUsage()` as process user and system CPU time in
microseconds. Node also states that the value can exceed elapsed time when the
process uses multiple CPU cores. See the [Node.js v24 process
documentation](https://nodejs.org/docs/latest-v24.x/api/process.html#processcpuusagepreviousvalue).

CPU time is a valid choice when the question is, “How much CPU work does this
handler consume?” It is not a measurement of end-to-end lint latency. It also
does not remove differences from CPU architecture, frequency scaling, JIT
state, garbage collection, or virtualization. The former code measured the
whole process interval around 10,000 callbacks. The interval included the
Effect execution cost, allocation behavior, and runtime state for that process.

The former five-sample median reduced the effect of one outlier. It did not
estimate the noise of the runner. The test had no sample deviation, percentile,
relative margin, or confidence calculation.

## Primary-source guidance

This certification cohort includes Vitest 4.1.10 and Tinybench 2.9.0 through
Vite+. Vitest's [benchmark configuration](https://vitest.dev/config/benchmark.html)
matches `*.bench.ts` files separately. It supports JSON output and comparison
through `vitest bench --outputJson` and `--compare`. The command in this
repository is `vp test bench`. Vitest marks the [benchmark API](https://vitest.dev/api/test.html#bench)
as experimental.

Tinybench 2.9.0 supports time-based warm-up and run duration. It computes mean,
variance, standard deviation, margin, relative margin, p75, and p99 from its
samples. See the [Tinybench 2.9.0 source](https://github.com/tinylibs/tinybench/tree/v2.9.0).
Vitest includes these aggregate values in its JSON report. These measurements
make runner noise visible. They do not make an absolute threshold portable.
Vitest 4 compares one current run with a saved JSON report. It does not run base
and candidate batches in an interleaved order. A strong blocking comparison
still needs alternating base and candidate batches on the same runner.

The Google Benchmark project documents warm-up time, repeated runs, CPU versus
real-time measurements, and statistical comparison. Its [comparison tool
guide](https://google.github.io/benchmark/tools.html) uses a statistical test
and reports a p-value instead of treating one absolute timing as a universal
limit. This is a useful model for a regression comparison.

Criterion's official [CI FAQ](https://bheisler.github.io/criterion.rs/book/faq.html)
gives a direct warning for this case. It says that cloud-CI virtualization,
including GitHub Actions, introduces substantial noise and can show large
performance changes when the code did not change. It recommends measuring the
base branch and the pull request branch on the same runner. Its [command-line
output guide](https://bheisler.github.io/criterion.rs/book/user_guide/command_line_output.html)
also says to inspect outliers and use a quiet machine for reliable results.

## Recommended design

Use each test type for one question:

| Question                                     | Method                                                 | Pull request gate                     |
| -------------------------------------------- | ------------------------------------------------------ | ------------------------------------- |
| Does the integration work?                   | Deterministic certification tests                      | Required                              |
| What does it cost today?                     | Isolated benchmark with a saved report                 | Informational                         |
| Did this change cause a material regression? | Same-runner base and candidate comparison              | Required only after noise calibration |
| Does it meet an absolute service budget?     | Fixed dedicated hardware and a representative workload | Required when such a budget exists    |

### Blocking certification

Keep these checks in the regular test suite:

- The pinned version cohort and package compatibility.
- The public compiler and ESLint compatibility surface.
- The `createOnce` lifecycle and diagnostic order.
- The real Vite+ lint fixture.
- Fix output and second-run idempotence.
- Other exact behavior checks that state a product contract.

The complete visitor timing test is no longer in this suite. Its callback
counters only checked its benchmark loop. The lifecycle test checks both visitor
paths. The absolute assertions certified a machine property instead of a code
contract.

### Non-blocking benchmark

The branch now has a dedicated `*.bench.ts` file. A separate job runs it with
`vp test bench`. The benchmark uses a representative fixture and records:

- Node version, Oxlint version, OS, architecture, and runner label.
- Direct and effectful samples from the same process.
- Mean, standard deviation, p75, p99, sample count, and relative margin of error.
- Elapsed time for the callback batches and the complete consumer fixture.

CI publishes the result as an artifact and a job summary. The job stays
informational until the project has a history of results.

### Blocking regression comparison

If performance must block a pull request, use this sequence:

1. Build the base revision and the pull request revision on the same runner.
2. Alternate base and candidate batches on that runner. Reverse or randomize
   their order across trials.
3. Use a representative fixture, rather than one synthetic AST callback.
4. Compare the candidate with the base by relative change.
5. Require both a practical regression margin and statistical evidence.
6. Repeat a failed comparison before marking the pull request failed.

The project must first measure repeated base-versus-base runs. That result sets
the noise margin. A fixed percentage without this baseline is another arbitrary
threshold.

If the requirement is an absolute latency or CPU budget, run that gate on a
dedicated, stable runner. GitHub's [self-hosted runner
reference](https://docs.github.com/en/actions/reference/runners/self-hosted-runners)
states that the machine must have enough hardware resources for its workflows.
The workflow must pin the machine, architecture, runtime, and operating-system
image.

## Conclusion

The benchmark loop is useful as an exploratory microbenchmark. The fixed 1 ms
and 25 ms limits are not valid required checks on `ubuntu-latest`. The current
CI failure only showed that this runner and runtime exceeded the fixed limit. It
does not show that the visitor contract failed or that this branch caused a
regression. Deterministic behavior tests must remain blocking. Performance must
be reported separately or compared to a same-runner base with measured noise
and a relative statistical gate.
