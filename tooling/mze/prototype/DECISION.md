# Human output decision

The prototype question was: which human-output structure makes `mze` easiest to
scan during development work?

Variant A is the selected design. It uses a dense event rail with one row for
each lifecycle event. A status mark carries the state. The command name stays
bold. Detail text stays short. Child process output passes through unchanged.

Variant A fits `mze` because it keeps live process output visible while it
shows the workflow state. Variant B gives more guidance than a long-running
session needs. Variant C hides event order behind a summary.

The production renderer in `../output.ts` now implements this contract with
ANSI colors only for human output. The JSON renderer remains versioned NDJSON.
This gallery stays as the design record for the rejected variants and the
selected structure.
