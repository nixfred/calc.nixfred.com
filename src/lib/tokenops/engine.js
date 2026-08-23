/* TokenOps formula engine.
   Every calculated value flows through defineFormula/evaluate and yields a
   FormulaTrace: answer, algebra, plain English, variables, live substitution,
   assumptions, sources, warnings. No hidden math (spec section 10, decision 20). */

export function fmt(n, digits) {
  if (n === null || n === undefined || Number.isNaN(n)) return 'unknown';
  if (typeof n !== 'number') return String(n);
  const d = digits !== undefined ? digits : (Math.abs(n) >= 100 ? 0 : Math.abs(n) >= 1 ? 2 : 4);
  return n.toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: 0 });
}

export function money(n, digits = 0) {
  if (n === null || n === undefined || Number.isNaN(n)) return 'unknown';
  return '$' + fmt(n, Math.abs(n) < 100 ? 2 : digits);
}

/* A formula definition:
   {
     id, title, shortAnswer, whyItMatters,
     plainEnglish, algebra, unit,
     vars: (state, R) => [{symbol, label, value, unit, source, editable}],
     compute: (v) => number   // v = {symbol: value}
     assumptions: (state) => [string],
     sourceIds: [string],
     warn: (value, v, state) => [{severity, message}],
     when: (state) => boolean  // include in evaluation?
   }
*/
export function makeEngine(defs) {
  return {
    defs,
    evaluate(state, registry = {}) {
      const R = {};            // id -> trace
      const values = {};       // id -> numeric value
      for (const def of defs) {
        if (def.when && !def.when(state, values)) continue;
        let trace;
        try {
          const vars = def.vars(state, values, registry).map((v) => ({
            editable: false, source: 'user input', unit: '', ...v,
          }));
          const v = Object.fromEntries(vars.map((x) => [x.symbol, x.value]));
          const value = def.compute(v, state, values);
          const substitution = buildSubstitution(def.algebra, vars, value, def.unit);
          const warnings = def.warn ? def.warn(value, v, state, values) : [];
          trace = {
            id: def.id,
            title: def.title,
            shortAnswer: def.shortAnswer,
            whyItMatters: def.whyItMatters,
            plainEnglish: def.plainEnglish,
            algebra: def.algebra,
            variables: vars,
            substitution,
            result: value,
            resultUnit: def.unit || '',
            assumptions: def.assumptions ? def.assumptions(state) : [],
            sourceIds: def.sourceIds || [],
            warnings,
            section: def.section || 'general',
          };
          values[def.id] = value;
        } catch (err) {
          trace = {
            id: def.id, title: def.title, shortAnswer: def.shortAnswer,
            whyItMatters: def.whyItMatters, plainEnglish: def.plainEnglish,
            algebra: def.algebra, variables: [], substitution: 'not computed',
            result: null, resultUnit: def.unit || '',
            assumptions: [], sourceIds: def.sourceIds || [],
            warnings: [{ severity: 'critical', message: 'Could not compute: ' + err.message }],
            section: def.section || 'general',
          };
          values[def.id] = null;
        }
        R[def.id] = trace;
      }
      return { traces: R, values };
    },
  };
}

function buildSubstitution(algebra, vars, value, unit) {
  // Replace each symbol on the right side of the algebra with its value.
  const rhs = algebra.includes('=') ? algebra.split('=').slice(1).join('=') : algebra;
  let sub = rhs.trim();
  // Longest symbols first so e.g. `users` does not clobber `concurrentUsers`.
  const ordered = [...vars].sort((a, b) => b.symbol.length - a.symbol.length);
  for (const v of ordered) {
    const val = typeof v.value === 'number' ? fmt(v.value) : String(v.value);
    sub = sub.split(v.symbol).join(val);
  }
  return `${fmt(value)}${unit ? ' ' + unit : ''} = ${sub}`;
}

/* Validation per spec section 36. Returns [{field, severity, message}]. */
export function validateInputs(s) {
  const out = [];
  const bad = (field, message, severity = 'critical') => out.push({ field, severity, message });

  const nonneg = [
    ['users', s.users], ['workflows', s.workflows], ['developers', s.developers],
    ['acDevelopers', s.acDevelopers], ['concurrentConnections', s.concurrentConnections],
    ['runsPerUserPerDay', s.runsPerUserPerDay], ['customWorkloadMonthlyTokens', s.customWorkloadMonthlyTokens],
    ['gpuQuote', s.gpuQuote], ['rentedGpuHourly', s.rentedGpuHourly],
  ];
  for (const [f, v] of nonneg) if (v !== null && v !== undefined && v < 0) bad(f, `${f} cannot be negative.`);

  const dayFields = ['activeDaysPerMonth', 'ragDays', 'agDays', 'codDays', 'acDays'];
  for (const f of dayFields) if (s[f] !== undefined && (s[f] < 1 || s[f] > 31)) bad(f, `Active days must be 1 to 31 (got ${s[f]}).`);
  const hourFields = ['activeHoursPerDay', 'ragHours', 'agHours', 'codHours', 'acHours'];
  for (const f of hourFields) if (s[f] !== undefined && (s[f] < 1 || s[f] > 24)) bad(f, `Active hours must be 1 to 24 (got ${s[f]}). The calculator will not silently use bad inputs.`);

  const pct = ['adoptionPercent', 'retryRatePercent', 'replanRatePercent', 'cachedInputPercent', 'escalationPercent', 'carryForwardPercent'];
  for (const f of pct) if (s[f] !== undefined && (s[f] < 0 || s[f] > 100)) bad(f, `${f} must be 0 to 100.`);

  if (s.usefulLifeMonths !== undefined && s.usefulLifeMonths <= 0) bad('usefulLifeMonths', 'Useful life must be greater than zero.');
  if (s.gpuMemoryUtilizationTarget !== undefined && (s.gpuMemoryUtilizationTarget <= 0 || s.gpuMemoryUtilizationTarget > 1)) {
    bad('gpuMemoryUtilizationTarget', 'GPU memory utilization target must be greater than 0 and at most 1.');
  }
  if (s.ragEnabled && s.chunkOverlap >= s.chunkSize) {
    bad('chunkOverlap', 'Chunk overlap must be smaller than chunk size, or chunk math divides by zero or goes negative.');
  }
  if (s.savingsThresholdPercent !== undefined && (s.savingsThresholdPercent < 0 || s.savingsThresholdPercent > 90)) {
    bad('savingsThresholdPercent', 'Savings threshold must be 0 to 90 percent; higher values invert the ceiling math.', 'caution');
  }
  // Cache hits apply only to the stable prompt prefix. With RAG or tool use on,
  // retrieved chunks and tool results change per call and cannot be prefix
  // cached, so a high cache rate overstates the discount.
  if ((s.ragEnabled || s.toolUseEnabled) && (s.cachedInputPercent ?? 0) > 50) {
    bad('cachedInputPercent', `Cache hits apply to the stable prompt prefix only. With ${s.ragEnabled && s.toolUseEnabled ? 'RAG and tool use' : s.ragEnabled ? 'RAG' : 'tool use'} on, retrieved and tool tokens change per call and bill uncached; ${s.cachedInputPercent} percent likely overstates the cached share.`, 'caution');
  }
  // Batch pricing needs up to 24 hour turnaround. Interactive agent work cannot
  // wait, so a batch share on a fast-completing agent is not honest.
  if ((s.batchEligiblePercent ?? 0) > 0 && s.wlModernAgent && (s.targetCompletionSeconds ?? 0) > 0 && s.targetCompletionSeconds < 3600) {
    bad('batchEligiblePercent', `Batch API pricing requires up to 24 hour turnaround, but this agent targets ${s.targetCompletionSeconds} second completion. Only non-interactive work (summaries, memory writes, offline jobs) qualifies for the batch discount.`, 'caution');
  }
  // The public-route-vs-policy conflict is enforced in the recommendation
  // engine (spec 37 critical warning), where the leading route is known.
  return out;
}
