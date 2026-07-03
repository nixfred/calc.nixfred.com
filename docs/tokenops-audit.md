# TokenOps completion audit

Audit of the shipped site against the controlling build spec
(18_tokenops_transparent_math_full_build_spec.md, local planning document).
Per settled decision 0.8.31, the authority is the automated harness:
`bun test` (math) + `bunx playwright test` (site). This document mirrors it,
one line per criterion, with evidence. Regenerate evidence any time by
running both commands.

Status legend: PASS (harness-enforced), PASS-I (verified by inspection,
not machine-checkable), PENDING.

## Section 46 QA scenario (exact numbers, harness-enforced)

1. PASS monthlyRuns = 200 * 5 * 22 * 0.50 * 1.00 = 11,000. Test: tokenops-math.test.js + e2e "Section 46".
2. PASS baseCallsPerRun = 1 + (2*2) + 1 + 1 = 7. Same tests.
3. PASS retryCallsPerRun = 7 * 0.10 = 0.7. Same tests.
4. PASS totalCallsPerRun = 7.7. Same tests.

## Section 45 acceptance criteria (1-40)

1. PASS Loads without external build tools at runtime; zero non-localhost requests observed (e2e criterion 1 test).
2. PASS-I Existing workload types present: RAG, Agents, Coding, Agentic Coding toggles in the Workload types section.
3. PASS RAG formula visible and editable (e2e legacy formulas test; constant editable in Workload section).
4. PASS Agents formula visible and editable (same).
5. PASS Coding formula visible and editable (same).
6. PASS Agentic coding formula visible and editable (same).
7. PASS Total monthly tokens calculated (unit + e2e).
8. PASS Tokens per minute calculated, both weighted and calendar methods, labeled (unit + e2e; spec 14.6).
9. PASS Tokens per second calculated (e2e asserts tps = tpm/60).
10. PASS Every token result renders FormulaTrace (e2e counts > 15 traces with algebra + substitution).
11. PASS-I Model size input accepts 8B, 13B, 30B, 8x7B (as ~47B active params note), 70B, 120B, 405B; implemented as a free parameter-count field, which covers all listed sizes and everything between.
12. PASS Quantization affects model memory (e2e: fp16 140 GB vs int4 35 GB for 70B).
13. PASS Model memory calculation shows formula (FormulaTrace).
14. PASS KV cache shows formula; both legacy quick and serving estimates rendered with an explanation of why they differ (spec 22).
15. PASS Vector DB calculation shows formula (legacy + growth views).
16. PASS GPU requirement shows formula; memory and throughput gates separate; winning gate visible (recommendedGpuCount trace).
17. PASS Provider cost calculation shows formula (per-role substitution strings + caching savings trace).
18. PASS Hardware economics shows formula, as amended by decision 0.4: the ceiling replaces hardware cost estimation.
19. PASS Break even calculation shows formula + chart (e2e criterion 14-19 test).
20. PASS Airia route with source link (e2e URL assertion).
21. PASS Kamiwaza route with source link (e2e).
22. PASS Build Technology Group route with source link (e2e).
23. PASS HPE Private Cloud AI route with source link (e2e).
24. PASS HPE DL380a direct link (e2e).
25. PASS-I HPE XD685 direct link renders in the hardware card (buy.hpe.com listing; automated fetch of hpe.com is bot-blocked, verified manually in browser).
26. PASS NVIDIA RTX PRO 6000 direct link (e2e).
27. PASS NVIDIA H200 direct link (e2e).
28. NOT SHIPPED (scope decision 0.4.17) NVIDIA L40S moved to release two by settled decision; criterion superseded by section 0.
29. PASS AMD MI355X direct AMD link (e2e).
30. PASS Provider price rows show source links (e2e counts source pills in rates table).
31. PASS All constants visible (FormulaTrace variables tables; assumptions listed with reasons).
32. PASS All assumptions editable (every rate cell is an input, e2e counts > 30; heuristic constants editable in their sections).
33. PASS Recommendation shows route scores 0-100 (e2e).
34. PASS Recommendation shows rules that fired (e2e).
35. PASS Recommendation shows missing data (do-not-size path lists missing gates; discovery card lists gaps).
36. PASS Recommendation shows confidence with the averaging substitution visible (e2e).
37. PASS Markdown export works (customer summary + detailed math; buttons asserted in e2e, generators unit-importable).
38. PASS Print report works (print overlay with formula appendix, sources, not-a-quote footer; decision 0.6.26 footer fields included).
39. PASS JSON export works (scenario save/load/import).
40. PASS No customer data transmitted externally by default (e2e network assertion; no analytics beacon on tokenops in this release).

## Section 0 settled decisions (1-32)

1. PASS-I Route is calc.nixfred.com/tokenops.
2. PASS Chooser screen with In a meeting / Deep sizing (e2e).
3. PASS-I Provenance sanitized: no public file names the internal foundation tool or the employer; heuristics labeled "field sizing heuristic" pointing at docs/tokenops.md. Verified by grep in the compliance audit.
4. PASS All four platform routes named with public links (e2e).
5. PASS Scores normalized 0-100 (e2e range assertion).
6. PASS Weight map drafted in route-rules.json with default/min/max; UI sliders live-reorder routes (e2e counts > 20 sliders). PENDING Fred's line-by-line weight review.
7. PASS Co-recommend within 10 points ("Two viable routes" path; margin in route-rules.json).
8. PASS Do-not-size fires on missing critical gates (unit + e2e).
9. PASS Big five providers seeded plus custom rows (provider-rates.json).
10. PASS Three tiers per provider, flagship/workhorse/mini.
11. PASS Stale warning at 60 days (source pill logic; zero stale today, e2e).
12. PASS Tokens priced, hardware never priced.
13. PASS Ceiling derivation with visible threshold rule (unit test: 10000 -> 6000/mo -> 216,000 capex).
14. PASS Capex only; no power/cooling/labor fields exist.
15. PASS Quote slot beside ceiling with instant under/over verdict (e2e both directions).
16. PASS Break even chart in release one (SVG, provider line + ceiling line + usage marker).
17. PASS Core five hardware profiles; L40S, Dell, Supermicro deferred.
18. PASS Benchmark defaults are conservative estimates, labeled ESTIMATED with sources, overridable; caution warning until a measured value is entered.
19. PASS Hybrid layout: Meeting wizard (e2e), Architect scroll with sticky section nav.
20. PASS FormulaTrace always expanded; zero collapsed blocks (e2e).
21. PASS Sticky summary bar with all four live numbers (e2e).
22. PASS Meeting Mode ~12 inputs across 4 steps with progressive reveal fields.
23. PASS Whiteboard card styled + copy-text button.
24. PASS All four exports in release one.
25. PASS Anonymous by default, Customer A (e2e); name warnings on export/share.
26. PASS Print footer: not-a-quote + URL/date + version/oldest-review + built-by.
27. PASS No section cuts: snowball, memory, full RAG, network all shipped.
28. PASS Phase-gated build with preview verification; nothing flips live until harness green.
29. PASS Share links via explicit button only; sanitized variant included.
30. PASS Autosave + named saves + clear-all control.
31. PASS Automated Playwright harness encodes section 46 numbers, machine-checkable section 45 criteria, and section 0 decisions. 21 e2e + 13 unit tests green.
32. PASS This document mirrors the harness.

## Adversarial audit findings

Five independent expert auditors (formula math, economics math, spec
compliance, UI design, QA coverage) attacked the build. Findings and their
resolutions are appended below when the audit completes.

## How to re-run the audit

1. `bun test` for the math contract.
2. `bunx playwright test` for the site contract.
3. Both green plus this document current = complete, per decision 0.8.31.
