# TokenOps methodology

TokenOps is an AI workload placement and token economics calculator at
[calc.nixfred.com/tokenops](https://calc.nixfred.com/tokenops). This document
is its public receipts: where the logic comes from, what the constants mean,
and where the tool's honesty limits are.

## The core principle

No hidden math. Every calculated number on screen shows:

1. What it calculates.
2. Why it matters.
3. The formula in plain English.
4. The formula in algebra.
5. Every variable and its value.
6. The live substitution with your numbers.
7. Assumptions, warnings, and source links.

If you find math you disagree with, the formulas live in
`src/lib/tokenops/formulas.js` and `src/lib/tokenops/costs.js`. Pull requests
with better math are welcome.

## Field sizing heuristics

Four quick-estimate constants are labeled "field sizing heuristic" in the
tool. They are editable rules of thumb from field sizing practice, useful for
first conversations and wrong for final designs:

1. A concurrent RAG session consumes about 2,000 tokens per minute.
2. An always-on agentic workflow consumes about 3,000 tokens per minute.
3. A coding assistant consumes about 90,909 tokens per active developer hour.
4. Agentic coding consumes about 104,167 tokens per active developer hour.

Every one of them is an editable default. If you have measured numbers, enter
them and the heuristics leave the math.

## The token model

The deep path models an agent workload as: monthly runs (users, habits,
adoption) times calls per run (topology: planners, workers, judges, retries,
replans) times tokens per call (per-role input and output anatomy, context
snowball, tool schemas and results, memory, retrieval). Retries and replans
scale the whole role mix proportionally, and fractional calls are shown as
averages on purpose.

## Provider pricing

Seed prices are public list prices per million tokens, read from official
provider pricing pages, with the review date shown on every row. Rows older
than 60 days show a STALE warning. Every cell is editable; edited rows are
marked user supplied and stop claiming their source. Public pricing is not
your contract pricing, and the tool says so.

## The hardware budget ceiling

TokenOps never prices hardware. It inverts the question: given what the token
route costs per month, and requiring owned infrastructure to be at least 40
percent cheaper before cost alone can justify it (operational risk, capacity
planning, lifecycle burden), the tool derives the number a hardware quote must
come UNDER for ownership to make sense. Capex only, by design. Enter a real
quote and get an under-or-over verdict instantly.

## GPU sizing

Memory fit and throughput fit are computed as separate gates and the larger
one wins. Memory sizing stacks weights, KV cache at the target concurrency,
runtime overhead, and safety margin. Throughput sizing divides the required
peak output tokens per second by a per-GPU benchmark. Benchmark defaults are
conservative estimates from public sources (NVIDIA NIM and TensorRT-LLM
performance docs, MLPerf Inference results, AMD ROCm publications), loudly
labeled ESTIMATED, and always overridable by a measured value. No benchmark,
no silent sizing.

## Route recommendation

The recommendation is a weighted score across candidate routes (direct
provider, cloud service, governed agent platform, private orchestration,
strategy partner, private cloud AI platform, rented GPU validation, owned
hardware, hybrid), normalized to 0 to 100. Every weight is visible in the
scoring panel and slidable within a reviewed range. The card shows the routes
that won, the routes that lost, the exact rules that fired, the confidence
level, and what to validate next. When the top two routes land within 10
points, the tool says so instead of pretending certainty. When critical
discovery is missing, the tool recommends not sizing yet.

## Privacy

Everything computes in the browser. No accounts, no server storage, no
analytics on entered values, no external calls with customer data. Scenarios
save to your browser's local storage only. Share links encode inputs only when
you explicitly create one, and warn if a customer name would be included.

## Limits

1. This is a conversation tool, not a quote, a BOM, or a vendor sizing engine.
2. Public list prices change; check the review dates.
3. Benchmark estimates are not your workload; validate before buying anything.
4. The route weights encode field judgment, which is opinionated on purpose.
