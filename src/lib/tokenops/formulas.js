/* TokenOps formula definitions. Spec sections 13-30.
   Section 46 QA anchors: monthlyRuns 11,000 | baseCallsPerRun 7 |
   retryCallsPerRun 0.7 | totalCallsPerRun 7.7. The Playwright harness
   enforces these exact numbers. */

import { makeEngine } from './engine.js';

const pct = (x) => (x ?? 0) / 100;
const BYTES_PER_PARAM = { fp16: 2, bf16: 2, fp8: 1, int8: 1, int4: 0.5 };

export const ROLE_LIST = ['planner', 'worker', 'judge', 'summarizer', 'router', 'critic'];

export function roleCallsPerRun(s, role) {
  switch (role) {
    case 'planner': return s.plannerCalls;
    case 'router': return s.routerCalls;
    case 'worker': return s.workerAgents * s.workerCallsPerAgent;
    case 'judge': return s.judgeCalls;
    case 'critic': return s.criticCalls;
    case 'summarizer': return s.summarizerCalls;
    default: return 0;
  }
}

const defs = [];

/* ---------- 14. Legacy quick workload formulas ---------- */

defs.push({
  id: 'ragMonthlyTokens', section: 'workload', unit: 'tokens per month',
  title: 'RAG monthly tokens (quick)',
  shortAnswer: 'Monthly tokens from concurrent RAG sessions.',
  whyItMatters: 'RAG assistants are often the first workload; this sets their baseline demand.',
  plainEnglish: 'tokens per session per minute times concurrent connections times days per month times hours per day times 60 minutes per hour',
  algebra: 'ragMonthlyTokens = ragTokensPerSessionMin * concurrentConnections * ragDays * ragHours * 60',
  when: (s) => s.wlRag,
  vars: (s) => [
    { symbol: 'ragTokensPerSessionMin', label: 'Tokens per RAG session per minute', value: s.ragTokensPerSessionMin, unit: 'tokens/min', editable: true, source: 'field sizing heuristic, editable' },
    { symbol: 'concurrentConnections', label: 'Concurrent connections', value: s.concurrentConnections },
    { symbol: 'ragDays', label: 'Days per month', value: s.ragDays },
    { symbol: 'ragHours', label: 'Hours per day', value: s.ragHours },
  ],
  compute: (v) => v.ragTokensPerSessionMin * v.concurrentConnections * v.ragDays * v.ragHours * 60,
  assumptions: () => ['Each concurrent RAG session consumes about 2,000 tokens per minute unless overridden.'],
  sourceIds: ['field_heuristic'],
});

defs.push({
  id: 'agentsMonthlyTokens', section: 'workload', unit: 'tokens per month',
  title: 'Agents monthly tokens (quick)',
  shortAnswer: 'Monthly tokens from always-on agentic workflows.',
  whyItMatters: 'Steady agent workflows are token furnaces; this is their quick estimate.',
  plainEnglish: 'tokens per minute per workflow times workflows times days per month times hours per day times 60',
  algebra: 'agentsMonthlyTokens = agentTokensPerWorkflowMin * workflows * agDays * agHours * 60',
  when: (s) => s.wlAgents,
  vars: (s) => [
    { symbol: 'agentTokensPerWorkflowMin', label: 'Tokens per workflow per minute', value: s.agentTokensPerWorkflowMin, unit: 'tokens/min', editable: true, source: 'field sizing heuristic, editable' },
    { symbol: 'workflows', label: 'Agentic workflows', value: s.workflows },
    { symbol: 'agDays', label: 'Days per month', value: s.agDays },
    { symbol: 'agHours', label: 'Hours per day', value: s.agHours },
  ],
  compute: (v) => v.agentTokensPerWorkflowMin * v.workflows * v.agDays * v.agHours * 60,
  assumptions: () => ['Each always-on workflow averages about 3,000 tokens per minute unless overridden.'],
  sourceIds: ['field_heuristic'],
});

defs.push({
  id: 'codingMonthlyTokens', section: 'workload', unit: 'tokens per month',
  title: 'Coding monthly tokens (quick)',
  shortAnswer: 'Monthly tokens from coding assistants.',
  whyItMatters: 'Developer assistants scale with headcount and active hours.',
  plainEnglish: 'tokens per hour per developer times developers times days per month times hours per day',
  algebra: 'codingMonthlyTokens = codingTokensPerDevHour * developers * codDays * codHours',
  when: (s) => s.wlCoding,
  vars: (s) => [
    { symbol: 'codingTokensPerDevHour', label: 'Tokens per developer hour', value: s.codingTokensPerDevHour, unit: 'tokens/hr', editable: true, source: 'field sizing heuristic, editable' },
    { symbol: 'developers', label: 'Developers', value: s.developers },
    { symbol: 'codDays', label: 'Days per month', value: s.codDays },
    { symbol: 'codHours', label: 'Hours per day', value: s.codHours },
  ],
  compute: (v) => v.codingTokensPerDevHour * v.developers * v.codDays * v.codHours,
  assumptions: () => ['A coding assistant consumes about 90,909 tokens per active developer hour unless overridden.'],
  sourceIds: ['field_heuristic'],
});

defs.push({
  id: 'agenticCodingMonthlyTokens', section: 'workload', unit: 'tokens per month',
  title: 'Agentic coding monthly tokens (quick)',
  shortAnswer: 'Monthly tokens from autonomous coding agents.',
  whyItMatters: 'Agentic coding plans, runs tools, tests, and reviews; it burns more than assistants.',
  plainEnglish: 'tokens per hour per developer times developers times days per month times hours per day',
  algebra: 'agenticCodingMonthlyTokens = agenticCodingTokensPerDevHour * acDevelopers * acDays * acHours',
  when: (s) => s.wlAgenticCoding,
  vars: (s) => [
    { symbol: 'agenticCodingTokensPerDevHour', label: 'Tokens per developer hour (agentic)', value: s.agenticCodingTokensPerDevHour, unit: 'tokens/hr', editable: true, source: 'field sizing heuristic, editable' },
    { symbol: 'acDevelopers', label: 'Developers', value: s.acDevelopers },
    { symbol: 'acDays', label: 'Days per month', value: s.acDays },
    { symbol: 'acHours', label: 'Hours per day', value: s.acHours },
  ],
  compute: (v) => v.agenticCodingTokensPerDevHour * v.acDevelopers * v.acDays * v.acHours,
  assumptions: () => ['Agentic coding consumes about 104,167 tokens per active developer hour unless overridden.'],
  sourceIds: ['field_heuristic'],
});

/* ---------- 13.4 Workload volume ---------- */

defs.push({
  id: 'monthlyRuns', section: 'volume', unit: 'runs per month',
  title: 'Monthly runs',
  shortAnswer: 'How many agent runs the workload produces each month.',
  whyItMatters: 'Every downstream token and cost number multiplies from this.',
  plainEnglish: 'users times runs per user per day times active days per month times adoption factor times seasonality multiplier',
  algebra: 'monthlyRuns = users * runsPerUserPerDay * activeDaysPerMonth * adoptionFactor * seasonalityMultiplier',
  when: (s) => s.wlModernAgent,
  vars: (s) => [
    { symbol: 'users', label: 'Users', value: s.users },
    { symbol: 'runsPerUserPerDay', label: 'Runs per user per day', value: s.runsPerUserPerDay },
    { symbol: 'activeDaysPerMonth', label: 'Active days per month', value: s.activeDaysPerMonth },
    { symbol: 'adoptionFactor', label: 'Adoption factor', value: pct(s.adoptionPercent), source: 'adoption percent / 100' },
    { symbol: 'seasonalityMultiplier', label: 'Seasonality multiplier', value: s.seasonalityMultiplier, editable: true },
  ],
  compute: (v) => v.users * v.runsPerUserPerDay * v.activeDaysPerMonth * v.adoptionFactor * v.seasonalityMultiplier,
  assumptions: (s) => [`Adoption is ${s.adoptionPercent} percent of licensed users actually running the agent.`],
  sourceIds: [],
});

/* ---------- 13.5 Agent topology ---------- */

defs.push({
  id: 'baseCallsPerRun', section: 'topology', unit: 'calls per run',
  title: 'Base model calls per run',
  shortAnswer: 'Model calls one run makes before retries and replans.',
  whyItMatters: 'Agent topology multiplies token cost invisibly; this makes the multiplier visible.',
  plainEnglish: 'planner calls plus router calls plus workers times calls each plus judge plus critic plus summarizer plus memory reads plus memory writes plus RAG calls plus tool planning plus tool result summaries',
  algebra: 'baseCallsPerRun = plannerCalls + routerCalls + (workerAgents * workerCallsPerAgent) + judgeCalls + criticCalls + summarizerCalls + memoryReadCalls + memoryWriteCalls + ragCallsPerRun + toolPlanningCalls + toolResultSummaryCalls',
  when: (s) => s.wlModernAgent,
  vars: (s) => [
    { symbol: 'plannerCalls', label: 'Planner calls', value: s.plannerCalls },
    { symbol: 'routerCalls', label: 'Router calls', value: s.routerCalls },
    { symbol: 'workerAgents', label: 'Worker agents', value: s.workerAgents },
    { symbol: 'workerCallsPerAgent', label: 'Calls per worker', value: s.workerCallsPerAgent },
    { symbol: 'judgeCalls', label: 'Judge calls', value: s.judgeCalls },
    { symbol: 'criticCalls', label: 'Critic calls', value: s.criticCalls },
    { symbol: 'summarizerCalls', label: 'Summarizer calls', value: s.summarizerCalls },
    { symbol: 'memoryReadCalls', label: 'Memory read calls', value: s.memoryReadCalls },
    { symbol: 'memoryWriteCalls', label: 'Memory write calls', value: s.memoryWriteCalls },
    { symbol: 'ragCallsPerRun', label: 'RAG calls', value: s.ragCallsPerRun },
    { symbol: 'toolPlanningCalls', label: 'Tool planning calls', value: s.toolPlanningCalls },
    { symbol: 'toolResultSummaryCalls', label: 'Tool result summary calls', value: s.toolResultSummaryCalls },
  ],
  compute: (v) => v.plannerCalls + v.routerCalls + v.workerAgents * v.workerCallsPerAgent + v.judgeCalls + v.criticCalls + v.summarizerCalls + v.memoryReadCalls + v.memoryWriteCalls + v.ragCallsPerRun + v.toolPlanningCalls + v.toolResultSummaryCalls,
  sourceIds: [],
});

defs.push({
  id: 'retryCallsPerRun', section: 'topology', unit: 'calls per run',
  title: 'Retry calls per run',
  shortAnswer: 'Extra calls caused by retries, shown as an average.',
  whyItMatters: 'Retries are silent cost. Fractional calls are averages, not rounding errors.',
  plainEnglish: 'base calls per run times the retry rate',
  algebra: 'retryCallsPerRun = baseCallsPerRun * retryRate',
  when: (s) => s.wlModernAgent,
  vars: (s, R) => [
    { symbol: 'baseCallsPerRun', label: 'Base calls per run', value: R.baseCallsPerRun, source: 'calculated above' },
    { symbol: 'retryRate', label: 'Retry rate', value: pct(s.retryRatePercent), source: 'retry percent / 100' },
  ],
  compute: (v) => v.baseCallsPerRun * v.retryRate,
  sourceIds: [],
});

defs.push({
  id: 'replanCallsPerRun', section: 'topology', unit: 'calls per run',
  title: 'Replan calls per run',
  shortAnswer: 'Extra planner calls from replanning.',
  whyItMatters: 'Replans multiply the most expensive role, the planner.',
  plainEnglish: 'planner calls times the replan rate',
  algebra: 'replanCallsPerRun = plannerCalls * replanRate',
  when: (s) => s.wlModernAgent,
  vars: (s) => [
    { symbol: 'plannerCalls', label: 'Planner calls', value: s.plannerCalls },
    { symbol: 'replanRate', label: 'Replan rate', value: pct(s.replanRatePercent), source: 'replan percent / 100' },
  ],
  compute: (v) => v.plannerCalls * v.replanRate,
  sourceIds: [],
});

defs.push({
  id: 'totalCallsPerRun', section: 'topology', unit: 'calls per run',
  title: 'Total model calls per run',
  shortAnswer: 'All model calls one run makes, retries and replans included.',
  whyItMatters: 'This is the real multiplier between runs and tokens.',
  plainEnglish: 'base calls plus retry calls plus replan calls',
  algebra: 'totalCallsPerRun = baseCallsPerRun + retryCallsPerRun + replanCallsPerRun',
  when: (s) => s.wlModernAgent,
  vars: (s, R) => [
    { symbol: 'baseCallsPerRun', label: 'Base calls', value: R.baseCallsPerRun, source: 'calculated above' },
    { symbol: 'retryCallsPerRun', label: 'Retry calls', value: R.retryCallsPerRun, source: 'calculated above' },
    { symbol: 'replanCallsPerRun', label: 'Replan calls', value: R.replanCallsPerRun, source: 'calculated above' },
  ],
  compute: (v) => v.baseCallsPerRun + v.retryCallsPerRun + v.replanCallsPerRun,
  assumptions: () => ['Fractional calls are averages across many runs, not hidden rounding.'],
  sourceIds: [],
});

/* ---------- 13.7 Context snowball ---------- */

defs.push({
  id: 'contextSnowballTokensPerCall', section: 'anatomy', unit: 'tokens per call',
  title: 'Context snowball tokens per call',
  shortAnswer: 'Extra input tokens later steps inherit from earlier steps.',
  whyItMatters: 'Agents that carry prior work forward quietly multiply input cost. High values signal a need for summarization or stricter loop control.',
  plainEnglish: 'carried steps times prior step input plus output tokens times the carry forward percent, compressed by the summary ratio when summaries are on',
  algebra: 'contextSnowballTokensPerCall = carriedSteps * (priorStepInputTokens + priorStepOutputTokens) * carryForwardPercent * compressionRatio',
  when: (s) => s.wlModernAgent && s.carryEnabled,
  vars: (s) => [
    { symbol: 'carriedSteps', label: 'Carried steps', value: s.carriedSteps },
    { symbol: 'priorStepInputTokens', label: 'Prior step input tokens', value: s.priorStepInputTokens },
    { symbol: 'priorStepOutputTokens', label: 'Prior step output tokens', value: s.priorStepOutputTokens },
    { symbol: 'carryForwardPercent', label: 'Carry forward share', value: pct(s.carryForwardPercent) },
    { symbol: 'compressionRatio', label: 'Summary compression ratio', value: s.summarizeCarry ? s.summaryCompressionRatio : 1, source: s.summarizeCarry ? 'summaries on' : 'summaries off, no compression' },
  ],
  compute: (v) => v.carriedSteps * (v.priorStepInputTokens + v.priorStepOutputTokens) * v.carryForwardPercent * v.compressionRatio,
  sourceIds: [],
});

/* ---------- 13.8 RAG ---------- */

defs.push({
  id: 'chunksPerDocument', section: 'rag', unit: 'chunks',
  title: 'Chunks per document',
  shortAnswer: 'How many chunks one average document becomes.',
  whyItMatters: 'Drives vector record counts and index growth.',
  plainEnglish: 'document tokens divided by chunk size minus overlap, rounded up',
  algebra: 'chunksPerDocument = ceil(documentTokens / (chunkSize - chunkOverlap))',
  when: (s) => s.ragEnabled,
  vars: (s) => [
    { symbol: 'documentTokens', label: 'Tokens per document', value: s.avgDocPages * s.tokensPerPage, source: 'pages times tokens per page' },
    { symbol: 'chunkSize', label: 'Chunk size', value: s.chunkSize, editable: true },
    { symbol: 'chunkOverlap', label: 'Chunk overlap', value: s.chunkOverlap, editable: true },
  ],
  compute: (v) => (v.chunkSize - v.chunkOverlap) > 0 ? Math.ceil(v.documentTokens / (v.chunkSize - v.chunkOverlap)) : null,
  warn: (value, v) => (v.chunkSize - v.chunkOverlap) > 0 ? [] : [{ severity: 'critical', message: 'Chunk overlap must be smaller than chunk size. Not computing garbage.' }],
  sourceIds: [],
});

defs.push({
  id: 'retrievedContextTokens', section: 'rag', unit: 'tokens per query',
  title: 'Retrieved context tokens',
  shortAnswer: 'Tokens each RAG query injects into the prompt.',
  whyItMatters: 'Retrieved context is usually the biggest single input line item.',
  plainEnglish: 'chunks retrieved per query times average tokens per chunk',
  algebra: 'retrievedContextTokens = chunksRetrievedPerQuery * avgTokensPerChunk',
  when: (s) => s.ragEnabled,
  vars: (s) => [
    { symbol: 'chunksRetrievedPerQuery', label: 'Chunks retrieved', value: s.chunksRetrievedPerQuery },
    { symbol: 'avgTokensPerChunk', label: 'Tokens per chunk', value: s.avgTokensPerChunk },
  ],
  compute: (v) => v.chunksRetrievedPerQuery * v.avgTokensPerChunk,
  sourceIds: [],
});

defs.push({
  id: 'vectorRecords', section: 'rag', unit: 'records',
  title: 'Vector records',
  shortAnswer: 'Total records in the vector store.',
  whyItMatters: 'Sizes the vector database and its memory footprint.',
  plainEnglish: 'documents indexed times chunks per document',
  algebra: 'vectorRecords = documentsIndexed * chunksPerDocument',
  when: (s) => s.ragEnabled,
  vars: (s, R) => [
    { symbol: 'documentsIndexed', label: 'Documents indexed', value: s.documentsIndexed },
    { symbol: 'chunksPerDocument', label: 'Chunks per document', value: R.chunksPerDocument, source: 'calculated above' },
  ],
  compute: (v) => v.documentsIndexed * v.chunksPerDocument,
  sourceIds: [],
});

defs.push({
  id: 'monthlyEmbeddingTokens', section: 'rag', unit: 'tokens per month',
  title: 'Monthly embedding tokens',
  shortAnswer: 'Tokens sent to the embedding model each month.',
  whyItMatters: 'Embedding cost is small per token but constant; churn makes it real.',
  plainEnglish: 'new or changed document tokens per month plus query embedding tokens',
  algebra: 'monthlyEmbeddingTokens = monthlyChangedDocTokens + queryEmbeddingTokens',
  when: (s) => s.ragEnabled,
  vars: (s, R) => [
    { symbol: 'monthlyChangedDocTokens', label: 'Changed document tokens per month', value: (s.dailyNewDocuments + s.dailyChangedDocuments) * 30 * s.avgDocPages * s.tokensPerPage, source: '(new + changed docs per day) * 30 * tokens per document' },
    { symbol: 'queryEmbeddingTokens', label: 'Query embedding tokens', value: (R.monthlyRuns ?? 0) * (s.ragCallsPerRun ?? 0) * 40, source: 'runs * RAG calls * ~40 tokens per query' },
  ],
  compute: (v) => v.monthlyChangedDocTokens + v.queryEmbeddingTokens,
  assumptions: () => ['Each RAG query embeds about 40 tokens of query text.'],
  sourceIds: [],
});

/* ---------- 13.9 Tools ---------- */

defs.push({
  id: 'toolSchemaOverheadPerCall', section: 'tools', unit: 'tokens per call',
  title: 'Tool schema overhead per call',
  shortAnswer: 'Prompt tokens spent just describing the available tools.',
  whyItMatters: 'Large tool catalogs tax every single call before any work happens.',
  plainEnglish: 'number of tools exposed times average schema tokens per tool',
  algebra: 'toolSchemaOverheadPerCall = toolsExposed * avgToolSchemaTokens',
  when: (s) => s.toolUseEnabled,
  vars: (s) => [
    { symbol: 'toolsExposed', label: 'Tools exposed', value: s.toolsExposed },
    { symbol: 'avgToolSchemaTokens', label: 'Schema tokens per tool', value: s.avgToolSchemaTokens, editable: true },
  ],
  compute: (v) => v.toolsExposed * v.avgToolSchemaTokens,
  warn: (value) => value > 4000 ? [{ severity: 'caution', message: 'Tool schemas over ~4,000 tokens per call are a major cost driver. Shrink the exposed tool set.' }] : [],
  sourceIds: [],
});

defs.push({
  id: 'toolResultTokensPerRun', section: 'tools', unit: 'tokens per run',
  title: 'Tool result tokens per run',
  shortAnswer: 'Tokens tool outputs add back into the conversation.',
  whyItMatters: 'Raw tool output is the other silent cost driver next to schemas.',
  plainEnglish: 'tool calls per run times tokens per tool result, using the summary size when summarization is on',
  algebra: 'toolResultTokensPerRun = toolCallsPerRun * tokensPerResult',
  when: (s) => s.toolUseEnabled,
  vars: (s) => [
    { symbol: 'toolCallsPerRun', label: 'Tool calls per run', value: s.toolCallsPerRun },
    { symbol: 'tokensPerResult', label: 'Tokens per result', value: s.toolResultSummarization ? s.toolResultSummaryTokens : s.avgToolResultTokens, source: s.toolResultSummarization ? 'summarized result size' : 'raw result size' },
  ],
  compute: (v) => v.toolCallsPerRun * v.tokensPerResult,
  sourceIds: [],
});

/* ---------- 13.10 Memory ---------- */

defs.push({
  id: 'memoryReadTokensPerRun', section: 'memory', unit: 'tokens per run',
  title: 'Memory read tokens per run',
  shortAnswer: 'Tokens pulled from long term memory per run.',
  whyItMatters: 'Memory recall adds input cost to every run it fires on.',
  plainEnglish: 'memory retrievals per run times chunks retrieved times tokens per chunk',
  algebra: 'memoryReadTokensPerRun = memRetrievalsPerRun * memChunksRetrieved * memChunkTokens',
  when: (s) => s.memoryEnabled,
  vars: (s) => [
    { symbol: 'memRetrievalsPerRun', label: 'Retrievals per run', value: s.memRetrievalsPerRun },
    { symbol: 'memChunksRetrieved', label: 'Chunks retrieved', value: s.memChunksRetrieved },
    { symbol: 'memChunkTokens', label: 'Tokens per chunk', value: s.memChunkTokens },
  ],
  compute: (v) => v.memRetrievalsPerRun * v.memChunksRetrieved * v.memChunkTokens,
  sourceIds: [],
});

defs.push({
  id: 'memoryWriteTokensPerRun', section: 'memory', unit: 'tokens per run',
  title: 'Memory write tokens per run',
  shortAnswer: 'Tokens spent writing memory summaries.',
  whyItMatters: 'Writes are output tokens, the expensive kind.',
  plainEnglish: 'memory writes per run times summary tokens per write',
  algebra: 'memoryWriteTokensPerRun = memWritesPerRun * memWriteSummaryTokens',
  when: (s) => s.memoryEnabled,
  vars: (s) => [
    { symbol: 'memWritesPerRun', label: 'Writes per run', value: s.memWritesPerRun },
    { symbol: 'memWriteSummaryTokens', label: 'Summary tokens per write', value: s.memWriteSummaryTokens },
  ],
  compute: (v) => v.memWritesPerRun * v.memWriteSummaryTokens,
  sourceIds: [],
});

/* ---------- 13.6 Token anatomy, aggregated over roles ---------- */

/* Single source of truth for billable tokens per run, per role.
   Used by BOTH the demand model (roleMonthly) and the cost engine
   (roleRoutedCost) so every counted token is also a priced token
   (adversarial audit finding: they had diverged).
   Attribution rules, stated: retries repeat the base role mix (retryScale);
   replans are extra PLANNER calls only (spec 13.5); run-level extras (tool
   results and schemas, memory reads, RAG context) are input tokens billed at
   the WORKER rate since workers consume them; memory-write summaries are
   output tokens billed at the summarizer's rate when one exists, else the
   worker's. Run-level extras retry-scale like the calls that produce them. */
export function effectiveRolePlan(s, R) {
  const base = R.baseCallsPerRun ?? 0;
  const retryScale = base > 0 ? (base + (R.retryCallsPerRun ?? 0)) / base : 1;
  const extraIn = retryScale * (
    (s.toolUseEnabled ? (R.toolResultTokensPerRun ?? 0) + (R.toolSchemaOverheadPerCall ?? 0) * ((s.toolPlanningCalls + s.toolResultSummaryCalls) || 1) : 0)
    + (s.memoryEnabled ? (R.memoryReadTokensPerRun ?? 0) : 0)
    + (s.ragEnabled ? (R.retrievedContextTokens ?? 0) * (s.ragCallsPerRun || 0) : 0));
  const extraOut = retryScale * (s.memoryEnabled ? (R.memoryWriteTokensPerRun ?? 0) : 0);
  const outRoleTarget = (s.summarizerCalls > 0 && s.roles.summarizer) ? 'summarizer' : 'worker';
  const plan = [];
  for (const role of ROLE_LIST) {
    let calls = roleCallsPerRun(s, role) * retryScale;
    if (role === 'planner') calls += R.replanCallsPerRun ?? 0;
    const r = s.roles[role];
    if (!calls || !r) continue;
    const snowball = (s.carryEnabled && (role === 'worker' || role === 'judge')) ? (R.contextSnowballTokensPerCall ?? 0) : 0;
    plan.push({
      role, calls,
      inPerRun: calls * (r.inputTokensPerCall + snowball) + (role === 'worker' ? extraIn : 0),
      outPerRun: calls * (r.outputTokensPerCall + (r.reasoningTokensPerCall || 0)) + (role === outRoleTarget ? extraOut : 0),
    });
  }
  // If no worker/summarizer roles are active, extras still count: pin to first role.
  if (plan.length && !plan.some((p) => p.role === 'worker') && extraIn) plan[0].inPerRun += extraIn;
  if (plan.length && !plan.some((p) => p.role === outRoleTarget) && extraOut) plan[0].outPerRun += extraOut;
  return { plan, retryScale };
}

function roleMonthly(s, R, kind) {
  const { plan } = effectiveRolePlan(s, R);
  return plan.reduce((a, p) => a + (kind === 'input' ? p.inPerRun : p.outPerRun), 0);
}

defs.push({
  id: 'inputTokensPerRun', section: 'anatomy', unit: 'tokens per run',
  title: 'Input tokens per run',
  shortAnswer: 'All prompt-side tokens one run consumes across every role.',
  whyItMatters: 'Input volume dominates most agent bills.',
  plainEnglish: 'sum over roles of calls times input tokens per call, plus tool, memory, and RAG additions, retries included',
  algebra: 'inputTokensPerRun = sum(roleCalls * callScale * roleInputTokens) + toolTokens + memoryReadTokens + ragTokens',
  when: (s) => s.wlModernAgent,
  vars: (s, R) => [
    { symbol: 'callScale', label: 'Retry and replan scale', value: R.baseCallsPerRun > 0 ? R.totalCallsPerRun / R.baseCallsPerRun : 1, source: 'totalCallsPerRun / baseCallsPerRun' },
  ],
  compute: (v, s, R) => roleMonthly(s, R, 'input'),
  assumptions: (s) => ['Retry and replan calls repeat the same role mix as base calls.',
    ...ROLE_LIST.filter((r) => roleCallsPerRun(s, r) > 0).map((r) => `${r}: ${roleCallsPerRun(s, r)} calls at ${s.roles[r].inputTokensPerCall.toLocaleString()} input tokens per call.`)],
  sourceIds: [],
});

defs.push({
  id: 'outputTokensPerRun', section: 'anatomy', unit: 'tokens per run',
  title: 'Output tokens per run',
  shortAnswer: 'All completion-side tokens one run produces.',
  whyItMatters: 'Output tokens usually cost 3 to 5 times input tokens.',
  plainEnglish: 'sum over roles of calls times output tokens per call, retries included, plus memory writes',
  algebra: 'outputTokensPerRun = sum(roleCalls * callScale * roleOutputTokens) + memoryWriteTokens',
  when: (s) => s.wlModernAgent,
  vars: (s, R) => [
    { symbol: 'callScale', label: 'Retry and replan scale', value: R.baseCallsPerRun > 0 ? R.totalCallsPerRun / R.baseCallsPerRun : 1, source: 'totalCallsPerRun / baseCallsPerRun' },
  ],
  compute: (v, s, R) => roleMonthly(s, R, 'output'),
  sourceIds: [],
});

defs.push({
  id: 'agentMonthlyInputTokens', section: 'anatomy', unit: 'tokens per month',
  title: 'Agent monthly input tokens',
  shortAnswer: 'Prompt-side tokens per month for the agent workload.',
  whyItMatters: 'Feeds provider cost directly.',
  plainEnglish: 'monthly runs times input tokens per run',
  algebra: 'agentMonthlyInputTokens = monthlyRuns * inputTokensPerRun',
  when: (s) => s.wlModernAgent,
  vars: (s, R) => [
    { symbol: 'monthlyRuns', label: 'Monthly runs', value: R.monthlyRuns, source: 'calculated above' },
    { symbol: 'inputTokensPerRun', label: 'Input tokens per run', value: R.inputTokensPerRun, source: 'calculated above' },
  ],
  compute: (v) => v.monthlyRuns * v.inputTokensPerRun,
  sourceIds: [],
});

defs.push({
  id: 'agentMonthlyOutputTokens', section: 'anatomy', unit: 'tokens per month',
  title: 'Agent monthly output tokens',
  shortAnswer: 'Completion-side tokens per month for the agent workload.',
  whyItMatters: 'The expensive half of the bill.',
  plainEnglish: 'monthly runs times output tokens per run',
  algebra: 'agentMonthlyOutputTokens = monthlyRuns * outputTokensPerRun',
  when: (s) => s.wlModernAgent,
  vars: (s, R) => [
    { symbol: 'monthlyRuns', label: 'Monthly runs', value: R.monthlyRuns, source: 'calculated above' },
    { symbol: 'outputTokensPerRun', label: 'Output tokens per run', value: R.outputTokensPerRun, source: 'calculated above' },
  ],
  compute: (v) => v.monthlyRuns * v.outputTokensPerRun,
  sourceIds: [],
});

defs.push({
  id: 'cachedInputTokensMonthly', section: 'anatomy', unit: 'tokens per month',
  title: 'Cached input tokens per month',
  shortAnswer: 'Input tokens served from prompt cache.',
  whyItMatters: 'Cached input is typically 10 percent of the normal input price.',
  plainEnglish: 'monthly input tokens times the cached share',
  algebra: 'cachedInputTokensMonthly = agentMonthlyInputTokens * cachedInputShare',
  when: (s) => s.wlModernAgent,
  vars: (s, R) => [
    { symbol: 'agentMonthlyInputTokens', label: 'Monthly input tokens', value: R.agentMonthlyInputTokens, source: 'calculated above' },
    { symbol: 'cachedInputShare', label: 'Cached share', value: pct(s.cachedInputPercent), source: 'cache hit percent / 100', editable: true },
  ],
  compute: (v) => v.agentMonthlyInputTokens * v.cachedInputShare,
  sourceIds: [],
});

defs.push({
  id: 'uncachedInputTokensMonthly', section: 'anatomy', unit: 'tokens per month',
  title: 'Uncached input tokens per month',
  shortAnswer: 'Input tokens billed at the full input rate.',
  whyItMatters: 'The full-price share of the prompt side.',
  plainEnglish: 'monthly input tokens times one minus the cached share',
  algebra: 'uncachedInputTokensMonthly = agentMonthlyInputTokens * (1 - cachedInputShare)',
  when: (s) => s.wlModernAgent,
  vars: (s, R) => [
    { symbol: 'agentMonthlyInputTokens', label: 'Monthly input tokens', value: R.agentMonthlyInputTokens, source: 'calculated above' },
    { symbol: 'cachedInputShare', label: 'Cached share', value: pct(s.cachedInputPercent) },
  ],
  compute: (v) => v.agentMonthlyInputTokens * (1 - v.cachedInputShare),
  sourceIds: [],
});

/* ---------- 14.5-14.7 Totals and rates ---------- */

defs.push({
  id: 'totalMonthlyTokens', section: 'totals', unit: 'tokens per month',
  title: 'Total monthly tokens',
  shortAnswer: 'Everything, all workloads combined.',
  whyItMatters: 'The headline demand number. Every route decision hangs off it.',
  plainEnglish: 'RAG plus agents plus coding plus agentic coding plus the modern agent workload plus custom workload tokens',
  algebra: 'totalMonthlyTokens = ragMonthlyTokens + agentsMonthlyTokens + codingMonthlyTokens + agenticCodingMonthlyTokens + agentMonthlyInputTokens + agentMonthlyOutputTokens + customWorkloadMonthlyTokens',
  vars: (s, R) => [
    { symbol: 'ragMonthlyTokens', label: 'RAG quick', value: R.ragMonthlyTokens ?? 0, source: s.wlRag ? 'calculated above' : 'workload off' },
    { symbol: 'agentsMonthlyTokens', label: 'Agents quick', value: R.agentsMonthlyTokens ?? 0, source: s.wlAgents ? 'calculated above' : 'workload off' },
    { symbol: 'codingMonthlyTokens', label: 'Coding quick', value: R.codingMonthlyTokens ?? 0, source: s.wlCoding ? 'calculated above' : 'workload off' },
    { symbol: 'agenticCodingMonthlyTokens', label: 'Agentic coding quick', value: R.agenticCodingMonthlyTokens ?? 0, source: s.wlAgenticCoding ? 'calculated above' : 'workload off' },
    { symbol: 'agentMonthlyInputTokens', label: 'Agent input', value: R.agentMonthlyInputTokens ?? 0, source: s.wlModernAgent ? 'calculated above' : 'workload off' },
    { symbol: 'agentMonthlyOutputTokens', label: 'Agent output', value: R.agentMonthlyOutputTokens ?? 0, source: s.wlModernAgent ? 'calculated above' : 'workload off' },
    { symbol: 'customWorkloadMonthlyTokens', label: 'Custom workload', value: s.customWorkloadMonthlyTokens ?? 0 },
  ],
  compute: (v) => v.ragMonthlyTokens + v.agentsMonthlyTokens + v.codingMonthlyTokens + v.agenticCodingMonthlyTokens + v.agentMonthlyInputTokens + v.agentMonthlyOutputTokens + v.customWorkloadMonthlyTokens,
  sourceIds: [],
});

defs.push({
  id: 'weightedTokensPerMinute', section: 'totals', unit: 'tokens per minute',
  title: 'Tokens per minute (weighted active)',
  shortAnswer: 'Demand rate during actual working minutes.',
  whyItMatters: 'Sizing must handle the active window, not the calendar average.',
  plainEnglish: 'total monthly tokens divided by the sum of each active workload\'s minutes',
  algebra: 'weightedTokensPerMinute = totalMonthlyTokens / totalActiveMinutes',
  vars: (s, R) => {
    let mins = 0;
    if (s.wlRag) mins += s.ragDays * s.ragHours * 60;
    if (s.wlAgents) mins += s.agDays * s.agHours * 60;
    if (s.wlCoding) mins += s.codDays * s.codHours * 60;
    if (s.wlAgenticCoding) mins += s.acDays * s.acHours * 60;
    if (s.wlModernAgent) mins += s.activeDaysPerMonth * s.activeHoursPerDay * 60;
    if (mins === 0) mins = 30 * 24 * 60;
    return [
      { symbol: 'totalMonthlyTokens', label: 'Total monthly tokens', value: R.totalMonthlyTokens, source: 'calculated above' },
      { symbol: 'totalActiveMinutes', label: 'Total active minutes', value: mins, source: 'sum of workload days * hours * 60' },
    ];
  },
  compute: (v) => v.totalMonthlyTokens / v.totalActiveMinutes,
  assumptions: () => ['Weighted method: each workload contributes its own active window. The calendar method below divides by every minute in a month instead.'],
  sourceIds: [],
});

defs.push({
  id: 'calendarTokensPerMinute', section: 'totals', unit: 'tokens per minute',
  title: 'Tokens per minute (calendar average)',
  shortAnswer: 'Demand rate spread across every minute of the month.',
  whyItMatters: 'The always-on view. Useful for steady batch workloads, misleading for bursty ones.',
  plainEnglish: 'total monthly tokens divided by 30 days times 24 hours times 60 minutes',
  algebra: 'calendarTokensPerMinute = totalMonthlyTokens / (30 * 24 * 60)',
  vars: (s, R) => [
    { symbol: 'totalMonthlyTokens', label: 'Total monthly tokens', value: R.totalMonthlyTokens, source: 'calculated above' },
  ],
  compute: (v) => v.totalMonthlyTokens / (30 * 24 * 60),
  sourceIds: [],
});

defs.push({
  id: 'weightedTokensPerSecond', section: 'totals', unit: 'tokens per second',
  title: 'Tokens per second (weighted active)',
  shortAnswer: 'The per-second version of the active-window rate.',
  whyItMatters: 'Hardware talk happens in tokens per second.',
  plainEnglish: 'weighted tokens per minute divided by 60',
  algebra: 'weightedTokensPerSecond = weightedTokensPerMinute / 60',
  vars: (s, R) => [
    { symbol: 'weightedTokensPerMinute', label: 'Weighted tokens per minute', value: R.weightedTokensPerMinute, source: 'calculated above' },
  ],
  compute: (v) => v.weightedTokensPerMinute / 60,
  sourceIds: [],
});

defs.push({
  id: 'calendarTokensPerSecond', section: 'totals', unit: 'tokens per second',
  title: 'Tokens per second (calendar average)',
  shortAnswer: 'The always-on per-second rate.',
  whyItMatters: 'Spec requires both methods so bursty and steady views are never conflated.',
  plainEnglish: 'calendar tokens per minute divided by 60',
  algebra: 'calendarTokensPerSecond = calendarTokensPerMinute / 60',
  vars: (s, R) => [
    { symbol: 'calendarTokensPerMinute', label: 'Calendar tokens per minute', value: R.calendarTokensPerMinute, source: 'calculated above' },
  ],
  compute: (v) => v.calendarTokensPerMinute / 60,
  sourceIds: [],
});

/* ---------- 21-22. Model memory and KV cache ---------- */

defs.push({
  id: 'modelWeightMemoryGB', section: 'sizing', unit: 'GB',
  title: 'Model weight memory',
  shortAnswer: 'Memory just to hold the model weights.',
  whyItMatters: 'The floor of GPU sizing. Real serving needs much more than this.',
  plainEnglish: 'parameter count in billions times bytes per parameter for the chosen precision',
  algebra: 'modelWeightMemoryGB = modelParamsB * bytesPerParameter',
  vars: (s) => [
    { symbol: 'modelParamsB', label: 'Model parameters (billions)', value: s.modelParamsB, editable: true },
    { symbol: 'bytesPerParameter', label: 'Bytes per parameter', value: BYTES_PER_PARAM[s.quantization] ?? 2, source: `${s.quantization} precision`, editable: true },
  ],
  compute: (v) => v.modelParamsB * v.bytesPerParameter,
  warn: () => [{ severity: 'info', message: 'Weights only. Serving also needs KV cache, runtime overhead, and safety margin, added below.' }],
  sourceIds: ['vllm_optimization'],
});

defs.push({
  id: 'kvCacheServingGB', section: 'sizing', unit: 'GB',
  title: 'KV cache memory (serving estimate)',
  shortAnswer: 'Memory the KV cache needs at the target concurrency.',
  whyItMatters: 'KV cache, not weights, is what kills long-context concurrent serving.',
  plainEnglish: 'concurrent sequences times context length times layers times KV heads times head dimension times 2 tensors times bytes per element',
  algebra: 'kvCacheServingGB = concurrentSequences * contextLengthTokens * kvLayers * kvHeads * kvHeadDim * 2 * kvBytesPerElement / 1e9',
  vars: (s) => [
    { symbol: 'concurrentSequences', label: 'Concurrent sequences', value: s.concurrentSequences, editable: true },
    { symbol: 'contextLengthTokens', label: 'Context length', value: s.contextLengthTokens, editable: true },
    { symbol: 'kvLayers', label: 'Layers', value: s.kvLayers, editable: true, source: 'model architecture, editable' },
    { symbol: 'kvHeads', label: 'KV heads', value: s.kvHeads, editable: true, source: 'model architecture, editable' },
    { symbol: 'kvHeadDim', label: 'Head dimension', value: s.kvHeadDim, editable: true, source: 'model architecture, editable' },
    { symbol: 'kvBytesPerElement', label: 'Bytes per element', value: s.kvBytesPerElement, editable: true, source: 'KV precision' },
  ],
  compute: (v) => v.concurrentSequences * v.contextLengthTokens * v.kvLayers * v.kvHeads * v.kvHeadDim * 2 * v.kvBytesPerElement / 1e9,
  assumptions: () => ['Defaults describe a 70B-class dense model (80 layers, 8 KV heads, 128 head dim). Edit for the real architecture.'],
  sourceIds: ['vllm_optimization'],
});

defs.push({
  id: 'kvCacheLegacyTB', section: 'sizing', unit: 'TB',
  title: 'KV cache (legacy quick estimate)',
  shortAnswer: 'The original quick KV formula, kept for continuity.',
  whyItMatters: 'Legacy method: sizes KV from daily token volume rather than concurrency. The serving estimate above is the better sizing tool; both are shown so the difference is visible.',
  plainEnglish: 'daily tokens times 2 tensors times 80 layers times 8 KV heads times 128 head dimension times the quantization factor, converted to TB',
  algebra: 'kvCacheLegacyTB = dailyTokens * 2 * 80 * 8 * 128 * kvQuantizationFactor / 1e12',
  vars: (s, R) => [
    { symbol: 'dailyTokens', label: 'Daily tokens', value: (R.totalMonthlyTokens ?? 0) / 30, source: 'total monthly tokens / 30' },
    { symbol: 'kvQuantizationFactor', label: 'Quantization factor', value: s.kvQuantizationFactor, editable: true },
  ],
  compute: (v) => v.dailyTokens * 2 * 80 * 8 * 128 * v.kvQuantizationFactor / 1e12,
  assumptions: () => ['Legacy quick estimate, field heuristic. Assumes 80 layers, 8 KV heads, 128 head dimension.'],
  sourceIds: ['field_heuristic'],
});

defs.push({
  id: 'runtimeOverheadGB', section: 'sizing', unit: 'GB',
  title: 'Runtime overhead',
  shortAnswer: 'Serving engine and CUDA graph overhead.',
  whyItMatters: 'Engines reserve real memory beyond weights.',
  plainEnglish: 'model weight memory times the runtime overhead percent',
  algebra: 'runtimeOverheadGB = modelWeightMemoryGB * runtimeOverheadPercent',
  vars: (s, R) => [
    { symbol: 'modelWeightMemoryGB', label: 'Model weight memory', value: R.modelWeightMemoryGB, source: 'calculated above' },
    { symbol: 'runtimeOverheadPercent', label: 'Runtime overhead share', value: pct(s.runtimeOverheadPercent), editable: true, source: 'default 15 percent, editable' },
  ],
  compute: (v) => v.modelWeightMemoryGB * v.runtimeOverheadPercent,
  sourceIds: ['vllm_optimization'],
});

defs.push({
  id: 'safetyMarginGB', section: 'sizing', unit: 'GB',
  title: 'Safety margin',
  shortAnswer: 'Headroom on top of everything.',
  whyItMatters: 'Fragmentation and spikes are real. Sizing to 100 percent is sizing to fail.',
  plainEnglish: 'weights plus KV cache plus runtime overhead, times the safety margin percent',
  algebra: 'safetyMarginGB = (modelWeightMemoryGB + kvCacheServingGB + runtimeOverheadGB) * safetyMarginPercent',
  vars: (s, R) => [
    { symbol: 'modelWeightMemoryGB', label: 'Weights', value: R.modelWeightMemoryGB, source: 'calculated above' },
    { symbol: 'kvCacheServingGB', label: 'KV cache', value: R.kvCacheServingGB, source: 'calculated above' },
    { symbol: 'runtimeOverheadGB', label: 'Runtime overhead', value: R.runtimeOverheadGB, source: 'calculated above' },
    { symbol: 'safetyMarginPercent', label: 'Safety margin share', value: pct(s.safetyMarginPercent), editable: true, source: 'default 20 percent, editable' },
  ],
  compute: (v) => (v.modelWeightMemoryGB + v.kvCacheServingGB + v.runtimeOverheadGB) * v.safetyMarginPercent,
  sourceIds: [],
});

defs.push({
  id: 'totalGpuMemoryRequiredGB', section: 'sizing', unit: 'GB',
  title: 'Total GPU memory required',
  shortAnswer: 'The full memory stack one model instance needs.',
  whyItMatters: 'This, against usable VRAM, sets the GPU count floor.',
  plainEnglish: 'weights plus KV cache plus runtime overhead plus safety margin',
  algebra: 'totalGpuMemoryRequiredGB = modelWeightMemoryGB + kvCacheServingGB + runtimeOverheadGB + safetyMarginGB',
  vars: (s, R) => [
    { symbol: 'modelWeightMemoryGB', label: 'Weights', value: R.modelWeightMemoryGB, source: 'calculated above' },
    { symbol: 'kvCacheServingGB', label: 'KV cache', value: R.kvCacheServingGB, source: 'calculated above' },
    { symbol: 'runtimeOverheadGB', label: 'Runtime overhead', value: R.runtimeOverheadGB, source: 'calculated above' },
    { symbol: 'safetyMarginGB', label: 'Safety margin', value: R.safetyMarginGB, source: 'calculated above' },
  ],
  compute: (v) => v.modelWeightMemoryGB + v.kvCacheServingGB + v.runtimeOverheadGB + v.safetyMarginGB,
  sourceIds: [],
});

defs.push({
  id: 'usableVramPerGpuGB', section: 'sizing', unit: 'GB',
  title: 'Usable VRAM per GPU',
  shortAnswer: 'What the serving engine can actually allocate.',
  whyItMatters: 'A GPU with enough raw VRAM can still fail on usable VRAM.',
  plainEnglish: 'GPU VRAM times the memory utilization target',
  algebra: 'usableVramPerGpuGB = gpuVramGB * gpuMemoryUtilizationTarget',
  vars: (s, R, reg) => [
    { symbol: 'gpuVramGB', label: 'GPU VRAM', value: reg.hardware?.find((h) => h.id === s.gpuChoice)?.memoryGB ?? 0, source: 'hardware profile, vendor page' },
    { symbol: 'gpuMemoryUtilizationTarget', label: 'Memory utilization target', value: s.gpuMemoryUtilizationTarget, editable: true, source: 'default 0.85, editable' },
  ],
  compute: (v) => v.gpuVramGB * v.gpuMemoryUtilizationTarget,
  sourceIds: [],
});

defs.push({
  id: 'gpusRequiredByMemory', section: 'sizing', unit: 'GPUs',
  title: 'GPUs required by memory',
  shortAnswer: 'The memory-bound GPU count.',
  whyItMatters: 'One of the two gates that set the recommended GPU count.',
  plainEnglish: 'total GPU memory required divided by usable VRAM per GPU, rounded up, times model instances',
  algebra: 'gpusRequiredByMemory = ceil(totalGpuMemoryRequiredGB / usableVramPerGpuGB) * modelInstances',
  vars: (s, R) => [
    { symbol: 'totalGpuMemoryRequiredGB', label: 'Total memory required', value: R.totalGpuMemoryRequiredGB, source: 'calculated above' },
    { symbol: 'usableVramPerGpuGB', label: 'Usable VRAM per GPU', value: R.usableVramPerGpuGB, source: 'calculated above' },
    { symbol: 'modelInstances', label: 'Model instances', value: s.modelInstances, editable: true },
  ],
  compute: (v) => Math.ceil(v.totalGpuMemoryRequiredGB / v.usableVramPerGpuGB) * v.modelInstances,
  sourceIds: [],
});

/* ---------- 25. Throughput ---------- */

defs.push({
  id: 'requiredSteadyOutputTps', section: 'throughput', unit: 'tokens per second',
  title: 'Required steady output tokens per second',
  shortAnswer: 'Average output rate during active hours.',
  whyItMatters: 'The baseline the hardware must sustain.',
  plainEnglish: 'monthly output tokens divided by active seconds per month',
  algebra: 'requiredSteadyOutputTps = agentMonthlyOutputTokens / activeSecondsPerMonth',
  when: (s) => s.wlModernAgent,
  vars: (s, R) => [
    { symbol: 'agentMonthlyOutputTokens', label: 'Monthly output tokens', value: R.agentMonthlyOutputTokens, source: 'calculated above' },
    { symbol: 'activeSecondsPerMonth', label: 'Active seconds per month', value: s.activeDaysPerMonth * s.activeHoursPerDay * 3600, source: 'days * hours * 3600' },
  ],
  compute: (v) => v.agentMonthlyOutputTokens / v.activeSecondsPerMonth,
  sourceIds: [],
});

defs.push({
  id: 'requiredPeakOutputTps', section: 'throughput', unit: 'tokens per second',
  title: 'Required peak output tokens per second',
  shortAnswer: 'Output rate during the worst window.',
  whyItMatters: 'Peak, not average, is what users feel.',
  plainEnglish: 'peak concurrent runs times output tokens per run divided by the target completion seconds',
  algebra: 'requiredPeakOutputTps = peakConcurrentRuns * outputTokensPerRun / targetCompletionSeconds',
  when: (s) => s.wlModernAgent,
  vars: (s, R) => [
    { symbol: 'peakConcurrentRuns', label: 'Peak concurrent runs', value: s.concurrentUsers * s.peakConcurrencyFactor, source: 'concurrent users * peak factor' },
    { symbol: 'outputTokensPerRun', label: 'Output tokens per run', value: R.outputTokensPerRun, source: 'calculated above' },
    { symbol: 'targetCompletionSeconds', label: 'Target completion seconds', value: s.targetCompletionSeconds, editable: true },
  ],
  compute: (v) => v.peakConcurrentRuns * v.outputTokensPerRun / v.targetCompletionSeconds,
  sourceIds: [],
});

defs.push({
  id: 'requiredRequestsPerSecond', section: 'throughput', unit: 'requests per second',
  title: 'Required requests per second',
  shortAnswer: 'Request throughput at peak.',
  whyItMatters: 'Providers rate limit on requests as well as tokens.',
  plainEnglish: 'peak concurrent runs divided by target completion seconds',
  algebra: 'requiredRequestsPerSecond = peakConcurrentRuns / targetCompletionSeconds',
  when: (s) => s.wlModernAgent,
  vars: (s) => [
    { symbol: 'peakConcurrentRuns', label: 'Peak concurrent runs', value: s.concurrentUsers * s.peakConcurrencyFactor, source: 'concurrent users * peak factor' },
    { symbol: 'targetCompletionSeconds', label: 'Target completion seconds', value: s.targetCompletionSeconds },
  ],
  compute: (v) => v.peakConcurrentRuns / v.targetCompletionSeconds,
  sourceIds: [],
});

defs.push({
  id: 'gpusRequiredByThroughput', section: 'throughput', unit: 'GPUs',
  title: 'GPUs required by throughput',
  shortAnswer: 'The throughput-bound GPU count.',
  whyItMatters: 'The second gate on the recommended GPU count.',
  plainEnglish: 'required peak output tokens per second divided by benchmark tokens per second per GPU times the target utilization, rounded up',
  algebra: 'gpusRequiredByThroughput = ceil(requiredPeakOutputTps / (benchmarkTpsPerGpu * targetGpuUtilization))',
  when: (s) => s.wlModernAgent,
  vars: (s, R, reg) => {
    const hw = reg.hardware?.find((h) => h.id === s.gpuChoice);
    const cls = s.modelParamsB >= 40 ? '70B-class' : '8B-class';
    const bench = s.userBenchmarkTpsPerGpu ?? hw?.defaultBench?.[cls] ?? null;
    return [
      { symbol: 'requiredPeakOutputTps', label: 'Required peak output TPS', value: R.requiredPeakOutputTps, source: 'calculated above' },
      { symbol: 'benchmarkTpsPerGpu', label: 'Benchmark output TPS per GPU', value: bench, editable: true, source: s.userBenchmarkTpsPerGpu ? 'user supplied measurement' : `ESTIMATED conservative default for ${cls} on this GPU, editable` },
      { symbol: 'targetGpuUtilization', label: 'Target GPU utilization', value: s.targetGpuUtilization, editable: true, source: 'default 0.70, editable' },
    ];
  },
  compute: (v) => v.benchmarkTpsPerGpu ? Math.ceil(v.requiredPeakOutputTps / (v.benchmarkTpsPerGpu * v.targetGpuUtilization)) : null,
  warn: (value, v, s) => v.benchmarkTpsPerGpu === null
    ? [{ severity: 'caution', message: 'No benchmark value for this exact combination. Throughput sizing is inert until a benchmark is entered.' }]
    : (s.userBenchmarkTpsPerGpu ? [] : [{ severity: 'caution', message: 'Benchmark TPS is an ESTIMATED public default, not a measurement of your workload. Validate with a real benchmark before committing hardware.' }]),
  sourceIds: ['mlcommons_inference', 'nvidia_genai_perf'],
});

defs.push({
  id: 'recommendedGpuCount', section: 'throughput', unit: 'GPUs',
  title: 'Recommended GPU count',
  shortAnswer: 'The GPU count that satisfies every gate.',
  whyItMatters: 'The number that walks into the hardware conversation.',
  plainEnglish: 'the larger of the memory-bound count, the throughput-bound count, and the platform minimum',
  algebra: 'recommendedGpuCount = max(gpusRequiredByMemory, gpusRequiredByThroughput, minimumPlatformGpuCount)',
  when: (s) => s.wlModernAgent,
  vars: (s, R) => [
    { symbol: 'gpusRequiredByMemory', label: 'Memory bound', value: R.gpusRequiredByMemory, source: 'calculated above' },
    { symbol: 'gpusRequiredByThroughput', label: 'Throughput bound', value: R.gpusRequiredByThroughput ?? 0, source: 'calculated above' },
    { symbol: 'minimumPlatformGpuCount', label: 'Platform minimum', value: s.minimumPlatformGpuCount, editable: true },
  ],
  compute: (v) => Math.max(v.gpusRequiredByMemory, v.gpusRequiredByThroughput, v.minimumPlatformGpuCount),
  assumptions: (s, R) => [],
  warn: (value, v) => {
    const winner = value === v.gpusRequiredByMemory && v.gpusRequiredByMemory >= v.gpusRequiredByThroughput
      ? 'MEMORY BOUND' : (value === v.gpusRequiredByThroughput ? 'THROUGHPUT BOUND' : 'PLATFORM MINIMUM BOUND');
    return [{ severity: 'info', message: `Gate that won: ${winner} (memory ${v.gpusRequiredByMemory}, throughput ${v.gpusRequiredByThroughput}, platform minimum ${v.minimumPlatformGpuCount}).` }];
  },
  sourceIds: [],
});

/* ---------- 23-24. Storage ---------- */

defs.push({
  id: 'vectorDbLegacyGB', section: 'storage', unit: 'GB per day',
  title: 'Vector DB growth (legacy quick)',
  shortAnswer: 'Daily vector store growth from token flow.',
  whyItMatters: 'Continuously indexed content grows storage forever.',
  plainEnglish: 'daily tokens divided by the 512 token chunk size, times 7,987 bytes per vector record, times the quantization factor, converted to GB',
  algebra: 'vectorDbLegacyGB = (dailyTokens / 512) * 7987 * kvQuantizationFactor / 1e9',
  vars: (s, R) => [
    { symbol: 'dailyTokens', label: 'Daily tokens', value: (R.totalMonthlyTokens ?? 0) / 30, source: 'total monthly / 30' },
    { symbol: 'kvQuantizationFactor', label: 'Quantization factor', value: s.kvQuantizationFactor, editable: true },
  ],
  compute: (v) => (v.dailyTokens / 512) * 7987 * v.kvQuantizationFactor / 1e9,
  assumptions: () => ['Legacy field heuristic: 512 token chunks, 7,987 bytes per vector record.'],
  sourceIds: ['field_heuristic'],
});

defs.push({
  id: 'traceStoragePerMonthGB', section: 'storage', unit: 'GB per month',
  title: 'Trace and audit storage per month',
  shortAnswer: 'Storage burned by keeping traces and logs.',
  whyItMatters: 'Audit requirements turn tokens into disk.',
  plainEnglish: 'monthly total tokens times average bytes per token in the trace, converted to GB',
  algebra: 'traceStoragePerMonthGB = totalMonthlyTokens * avgBytesPerTokenInTrace / 1e9',
  vars: (s, R) => [
    { symbol: 'totalMonthlyTokens', label: 'Total monthly tokens', value: R.totalMonthlyTokens, source: 'calculated above' },
    { symbol: 'avgBytesPerTokenInTrace', label: 'Bytes per token in trace', value: s.avgBytesPerTokenInTrace, editable: true },
  ],
  compute: (v) => v.totalMonthlyTokens * v.avgBytesPerTokenInTrace / 1e9,
  sourceIds: [],
});

defs.push({
  id: 'protectedStorageTB', section: 'storage', unit: 'TB',
  title: 'Protected storage at retention',
  shortAnswer: 'Raw storage with growth, replication, and backups applied.',
  whyItMatters: 'Raw capacity is never what gets bought.',
  plainEnglish: 'raw storage times one plus growth, times replication factor, times backup factor',
  algebra: 'protectedStorageTB = rawStorageTB * (1 + storageGrowthPercent) * replicationFactor * backupFactor',
  vars: (s, R) => {
    const raw = (s.modelRepoTB ?? 0)
      + ((R.vectorDbLegacyGB ?? 0) * 30 * (s.retentionMonths ?? 1)) / 1000 * (s.indexOverheadFactor ?? 1)
      + ((R.traceStoragePerMonthGB ?? 0) * (s.retentionMonths ?? 1)) / 1000;
    return [
      { symbol: 'rawStorageTB', label: 'Raw storage at retention', value: raw, source: 'model repo + vector DB + traces at retention months' },
      { symbol: 'storageGrowthPercent', label: 'Growth share', value: pct(s.storageGrowthPercent), editable: true },
      { symbol: 'replicationFactor', label: 'Replication factor', value: s.replicationFactor, editable: true },
      { symbol: 'backupFactor', label: 'Backup factor', value: s.backupFactor, editable: true },
    ];
  },
  compute: (v) => v.rawStorageTB * (1 + v.storageGrowthPercent) * v.replicationFactor * v.backupFactor,
  sourceIds: [],
});

/* ---------- 27. Network ---------- */

defs.push({
  id: 'userResponseBandwidthMbps', section: 'network', unit: 'Mbps',
  title: 'User response traffic',
  shortAnswer: 'Bandwidth the streamed responses need at peak.',
  whyItMatters: 'Front-end sizing input; usually small, occasionally surprising.',
  plainEnglish: 'peak output tokens per second times bytes per token times 8 bits, in megabits',
  algebra: 'userResponseBandwidthMbps = requiredPeakOutputTps * avgBytesPerToken * 8 / 1e6',
  when: (s) => s.wlModernAgent,
  vars: (s, R) => [
    { symbol: 'requiredPeakOutputTps', label: 'Peak output TPS', value: R.requiredPeakOutputTps, source: 'calculated above' },
    { symbol: 'avgBytesPerToken', label: 'Bytes per token', value: s.avgBytesPerToken, editable: true, source: 'default 4, editable' },
  ],
  compute: (v) => v.requiredPeakOutputTps * v.avgBytesPerToken * 8 / 1e6,
  sourceIds: [],
});

defs.push({
  id: 'ragTrafficMbps', section: 'network', unit: 'Mbps',
  title: 'RAG data traffic',
  shortAnswer: 'Bandwidth retrieval pulls at peak.',
  whyItMatters: 'Retrieval payloads dwarf token streams.',
  plainEnglish: 'peak RAG queries per second times retrieved bytes per query times 8 bits, in megabits',
  algebra: 'ragTrafficMbps = peakRagQps * avgRetrievedBytesPerQuery * 8 / 1e6',
  when: (s) => s.ragEnabled,
  vars: (s, R) => [
    { symbol: 'peakRagQps', label: 'Peak RAG queries per second', value: (R.requiredRequestsPerSecond ?? 0) * (s.ragCallsPerRun ?? 0), source: 'requests per second * RAG calls per run' },
    { symbol: 'avgRetrievedBytesPerQuery', label: 'Bytes per query', value: s.avgRetrievedBytesPerQuery, editable: true },
  ],
  compute: (v) => v.peakRagQps * v.avgRetrievedBytesPerQuery * 8 / 1e6,
  sourceIds: [],
});

defs.push({
  id: 'toolTrafficMbps', section: 'network', unit: 'Mbps',
  title: 'Tool traffic',
  shortAnswer: 'Bandwidth tool calls consume at peak.',
  whyItMatters: 'Chatty tools tax the network alongside the tokens.',
  plainEnglish: 'peak tool calls per second times payload bytes times 8 bits, in megabits',
  algebra: 'toolTrafficMbps = peakToolCps * avgToolPayloadBytes * 8 / 1e6',
  when: (s) => s.toolUseEnabled,
  vars: (s, R) => [
    { symbol: 'peakToolCps', label: 'Peak tool calls per second', value: (R.requiredRequestsPerSecond ?? 0) * (s.toolCallsPerRun ?? 0), source: 'requests per second * tool calls per run' },
    { symbol: 'avgToolPayloadBytes', label: 'Payload bytes per call', value: s.avgToolPayloadBytes, editable: true },
  ],
  compute: (v) => v.peakToolCps * v.avgToolPayloadBytes * 8 / 1e6,
  sourceIds: [],
});

defs.push({
  id: 'totalApplicationNetworkMbps', section: 'network', unit: 'Mbps',
  title: 'Total application network',
  shortAnswer: 'The front-side network requirement.',
  whyItMatters: 'Backend GPU fabric is a separate, rule-based question shown beside this.',
  plainEnglish: 'user traffic plus RAG traffic plus tool traffic plus overhead',
  algebra: 'totalApplicationNetworkMbps = userResponseBandwidthMbps + ragTrafficMbps + toolTrafficMbps + networkOverheadMbps',
  vars: (s, R) => [
    { symbol: 'userResponseBandwidthMbps', label: 'User traffic', value: R.userResponseBandwidthMbps ?? 0, source: 'calculated above' },
    { symbol: 'ragTrafficMbps', label: 'RAG traffic', value: R.ragTrafficMbps ?? 0, source: 'calculated above' },
    { symbol: 'toolTrafficMbps', label: 'Tool traffic', value: R.toolTrafficMbps ?? 0, source: 'calculated above' },
    { symbol: 'networkOverheadMbps', label: 'Overhead', value: s.networkOverheadMbps, editable: true },
  ],
  compute: (v) => v.userResponseBandwidthMbps + v.ragTrafficMbps + v.toolTrafficMbps + v.networkOverheadMbps,
  warn: () => [{ severity: 'info', message: 'Application traffic only. Multi-node GPU serving needs separate backend fabric planning; see the fabric rules beside this card.' }],
  sourceIds: [],
});

export const engine = makeEngine(defs);
export const formulaDefs = defs;
