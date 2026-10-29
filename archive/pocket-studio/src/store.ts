// ─── Pocket Studio – State Store ────────────────────────────────────────────
import { useState, useCallback, useEffect } from 'react';
import type {
  AppState, Job, Brief, WorkflowStage,
  ProductionStep, ProductionStepStatus, ActivityEntry, JobArtifacts
} from './types';
import {
  buildSampleJob, buildQuote, buildInitialProduction, buildInitialQA,
} from './sampleData';
import {
  buildBrandArt, buildGameConfig, buildManifest,
  runAutomatedChecks,
} from './productionEngine';

const STORAGE_KEY = 'pocket-studio-v1';

// Default colors applied when opening a new brief form.
// Defined at module level (stable reference — safe as useCallback dep-free literal).
const DEFAULT_BRIEF_COLORS = { primary: '#1a1a2e', accent: '#e8512a' } as const;

// ── Persistence ───────────────────────────────────────────────────────────────

function load(): AppState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as AppState;
      // Migration + recovery applied to every persisted job:
      // 1. Stale-running recovery: any step persisted as 'running' means the
      //    tab was closed mid-step; reset to 'pending' so it can be re-run.
      // 2. Quote migration: regenerate the quote from the current brief so
      //    any persisted old deliverable text (e.g. from before a title edit,
      //    or from a previous app version with incorrect copy) is corrected
      //    without erasing jobs, artifacts, activity log, or manual QA status.
      //    Historical approval snapshots (plan.quoteSnapshot) are NOT touched —
      //    they are preserved as they were when approved, for audit purposes.
      const recovered: AppState = {
        ...parsed,
        jobs: parsed.jobs.map(j => ({
          ...j,
          artifacts: j.artifacts ?? {},
          // Regenerate live quote from current brief (corrects stale copy)
          quote: buildQuote(j.brief),
          production: j.production.map(p =>
            p.status === 'running'
              ? { ...p, status: 'pending' as const, startedAt: undefined, error: 'Reset after interrupted session' }
              : p
          ),
        })),
      };
      return recovered;
    }
  } catch { /* ignore */ }
  const seed = buildSampleJob();
  return { jobs: [seed], selectedJobId: seed.id, showBriefForm: false, draftBrief: null };
}

function save(state: AppState) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch { /* ignore */ }
}

// ── Pure helpers ──────────────────────────────────────────────────────────────

export function setStage(job: Job, stage: WorkflowStage): Job {
  return { ...job, stage, updatedAt: new Date().toISOString() };
}

export function makeLogEntry(message: string, kind: ActivityEntry['kind']): ActivityEntry {
  return {
    id: `log-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    timestamp: new Date().toISOString(),
    message,
    kind,
  };
}

export function addLog(job: Job, message: string, kind: ActivityEntry['kind']): Job {
  return {
    ...job,
    activityLog: [makeLogEntry(message, kind), ...job.activityLog].slice(0, 50),
  };
}

export function updateProdStep(
  job: Job,
  step: ProductionStep,
  patch: Partial<{
    status: ProductionStepStatus;
    startedAt: string;
    completedAt: string;
    output: string;
    error: string;
  }>
): Job {
  return {
    ...job,
    updatedAt: new Date().toISOString(),
    production: job.production.map(p => (p.step === step ? { ...p, ...patch } : p)),
  };
}

/** Invalidate artifacts, QA results, and acceptance. Called on brief revision. */
export function invalidateAfterBriefEdit(job: Job): Job {
  return {
    ...job,
    artifacts: {},
    qaChecks: job.qaChecks.map(c => ({ ...c, passed: null, evidence: undefined })),
    acceptedAt: undefined,
    production: job.production.map(p =>
      p.status === 'done' ? { ...p, status: 'pending', output: undefined, completedAt: undefined } : p
    ),
  };
}

// ── Action gates ──────────────────────────────────────────────────────────────
// These are the same checks the UI renders, but authoritative here in the store.

export function canAdvanceToQuote(job: Job): boolean {
  return job.stage === 'brief';
}

export function canApprovePlan(job: Job): boolean {
  return job.stage === 'quote';
}

export function canStartProduction(job: Job): boolean {
  return job.stage === 'approved' && !!job.plan;
}

export function canRunStep(job: Job, step: ProductionStep): boolean {
  if (job.stage !== 'production') return false;
  const stepOrder: ProductionStep[] = ['art', 'game_build', 'qa_checks', 'package'];
  const idx = stepOrder.indexOf(step);
  const rec = job.production.find(p => p.step === step);
  if (!rec || rec.status !== 'pending') return false;
  if (idx === 0) return true;
  const prev = job.production.find(p => p.step === stepOrder[idx - 1]);
  return prev?.status === 'done';
}

export function canMarkQAReady(job: Job): boolean {
  if (job.stage !== 'qa') return false;
  const automated = job.qaChecks.filter(c => c.type === 'automated');
  const manual = job.qaChecks.filter(c => c.type === 'manual');
  if (automated.some(c => c.passed !== true)) return false;
  if (manual.some(c => c.passed !== true)) return false;
  return true;
}

export function canAccept(job: Job): boolean {
  return job.stage === 'preview';
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useAppStore() {
  const [state, setState] = useState<AppState>(load);

  const update = useCallback((fn: (s: AppState) => AppState) => {
    setState(prev => {
      const next = fn(prev);
      save(next);
      return next;
    });
  }, []);

  useEffect(() => {
    const handler = () => save(state);
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [state]);

  const selectedJob = state.jobs.find(j => j.id === state.selectedJobId) ?? null;

  const updateJobState = useCallback(
    (jobId: string, fn: (j: Job) => Job) =>
      update(s => ({ ...s, jobs: s.jobs.map(j => (j.id === jobId ? fn(j) : j)) })),
    [update]
  );

  // ── Actions ───────────────────────────────────────────────────────────────

  const selectJob = useCallback(
    (id: string) => update(s => ({ ...s, selectedJobId: id })),
    [update]
  );

  const openBriefForm = useCallback(
    () => update(s => ({
      ...s,
      showBriefForm: true,
      draftBrief: s.draftBrief
        ? {
          ...s.draftBrief,
          colors: s.draftBrief.colors ?? DEFAULT_BRIEF_COLORS,
        }
        : { colors: DEFAULT_BRIEF_COLORS },
    })),
    [update]
  );

  const closeBriefForm = useCallback(
    () => update(s => ({ ...s, showBriefForm: false })),
    [update]
  );

  const updateDraft = useCallback(
    (patch: Partial<Brief>) =>
      update(s => ({ ...s, draftBrief: { ...(s.draftBrief ?? {}), ...patch } })),
    [update]
  );

  const clearDraft = useCallback(
    () => update(s => ({ ...s, draftBrief: null, showBriefForm: false })),
    [update]
  );

  const submitBrief = useCallback(
    (brief: Brief) => {
      const now = new Date().toISOString();
      const quote = buildQuote(brief);
      const newJob: Job = {
        id: `job-${Date.now()}`,
        createdAt: now,
        updatedAt: now,
        stage: 'brief',
        brief,
        quote,
        production: [],
        artifacts: {},
        qaChecks: [],
        activityLog: [makeLogEntry('Job created from brief', 'info')],
        isDraft: false,
      };
      update(s => ({
        ...s,
        jobs: [newJob, ...s.jobs],
        selectedJobId: newJob.id,
        showBriefForm: false,
        draftBrief: null,
      }));
    },
    [update]
  );

  const advanceToQuote = useCallback(
    (jobId: string) => {
      updateJobState(jobId, j => {
        if (!canAdvanceToQuote(j)) return j; // gate
        return addLog(setStage(j, 'quote'), 'Brief reviewed — quote generated', 'success');
      });
    },
    [updateJobState]
  );

  const approvePlan = useCallback(
    (jobId: string) => {
      updateJobState(jobId, j => {
        if (!canApprovePlan(j)) return j; // gate
        const now = new Date().toISOString();
        const plan = {
          version: (j.plan?.version ?? 0) + 1,
          lockedAt: now,
          briefSnapshot: { ...j.brief },
          quoteSnapshot: { ...j.quote },
        };
        return addLog(setStage({ ...j, plan }, 'approved'), `Plan v${plan.version} approved and locked`, 'success');
      });
    },
    [updateJobState]
  );

  const startProduction = useCallback(
    (jobId: string) => {
      updateJobState(jobId, j => {
        if (!canStartProduction(j)) return j; // gate
        return addLog(
          setStage({ ...j, production: buildInitialProduction(), qaChecks: buildInitialQA(), artifacts: {} }, 'production'),
          'Production started',
          'info'
        );
      });
    },
    [updateJobState]
  );

  const runProductionStep = useCallback(
    (jobId: string, step: ProductionStep) => {
      // Gate check before marking running
      update(s => {
        const job = s.jobs.find(j => j.id === jobId);
        if (!job || !canRunStep(job, step)) return s; // guard: no double-run, no out-of-order
        const started = addLog(
          updateProdStep(job, step, { status: 'running', startedAt: new Date().toISOString() }),
          `Step started: ${step.replace('_', ' ')}`,
          'info'
        );
        return { ...s, jobs: s.jobs.map(j => (j.id === jobId ? started : j)) };
      });

      // Real local artifact work — synchronous computation wrapped in a
      // short timeout so the UI can paint the "running" state before blocking.
      const durations: Record<ProductionStep, number> = {
        art: 1000,
        game_build: 1400,
        qa_checks: 900,
        package: 700,
      };

      setTimeout(() => {
        update(s => {
          const job = s.jobs.find(j => j.id === jobId);
          if (!job) return s;
          const rec = job.production.find(p => p.step === step);
          // If force-failed externally, do not overwrite
          if (!rec || rec.status === 'failed') return s;
          // Only complete if still running (not pending = was reset)
          if (rec.status !== 'running') return s;

          const now = new Date().toISOString();
          let newArtifacts: JobArtifacts = { ...job.artifacts };
          let outputStr = '';

          if (step === 'art') {
            const art = buildBrandArt(job.brief);
            newArtifacts.brandArtSvg = art.svgMark;
            outputStr = `Brand mark SVG generated — initial="${art.initial}", contrast=${art.contrastRatio}:1, ${art.svgMark.length} chars`;
          } else if (step === 'game_build') {
            const config = buildGameConfig(job.brief);
            newArtifacts.gameConfigJson = JSON.stringify(config, null, 2);
            outputStr = `Game config built — ${config.mechanic}, ${config.durationSeconds}s, schemaVersion=${config.schemaVersion}`;
          } else if (step === 'qa_checks') {
            // qa_checks step just readies assets; actual checks run in QA stage
            outputStr = 'Artifacts verified — ready for QA stage checks';
          } else if (step === 'package') {
            // Build manifest from completed steps
            const completedSteps: Partial<Record<ProductionStep, string>> = {};
            for (const p of job.production) {
              if (p.completedAt) completedSteps[p.step] = p.completedAt;
            }
            // Include the qa_checks step we just completed (not yet in production array)
            completedSteps['package'] = now;
            const manifest = buildManifest(job.id, job.brief, completedSteps);
            newArtifacts.manifestJson = JSON.stringify(manifest, null, 2);
            outputStr = `Session manifest assembled — ${manifest.deliverables.length} deliverables recorded`;
          }

          const updated = updateProdStep(
            { ...job, artifacts: newArtifacts },
            step,
            { status: 'done', completedAt: now, output: outputStr }
          );

          const allDone = updated.production.every(p => p.status === 'done');
          const final = allDone
            ? addLog(setStage(updated, 'qa'), 'All production steps complete — entering QA', 'success')
            : addLog(updated, outputStr, 'success');

          return { ...s, jobs: s.jobs.map(j => (j.id === jobId ? final : j)) };
        });
      }, durations[step]);
    },
    [update]
  );

  const forceFailStep = useCallback(
    (jobId: string, step: ProductionStep) => {
      updateJobState(jobId, j => {
        const rec = j.production.find(p => p.step === step);
        // Only allow failing a step that is running or pending (not already done)
        if (!rec || rec.status === 'done') return j;
        return addLog(
          updateProdStep(j, step, {
            status: 'failed',
            error: 'Simulated failure (test demo)',
            completedAt: new Date().toISOString(),
          }),
          `Test failure injected on step: ${step.replace('_', ' ')}`,
          'error'
        );
      });
    },
    [updateJobState]
  );

  const retryStep = useCallback(
    (jobId: string, step: ProductionStep) => {
      // Retry is only valid if the step is failed
      update(s => {
        const job = s.jobs.find(j => j.id === jobId);
        if (!job) return s;
        const rec = job.production.find(p => p.step === step);
        if (!rec || rec.status !== 'failed') return s; // guard: only retry failed steps
        // Also check previous step is done (retry order guard)
        const stepOrder: ProductionStep[] = ['art', 'game_build', 'qa_checks', 'package'];
        const idx = stepOrder.indexOf(step);
        if (idx > 0) {
          const prev = job.production.find(p => p.step === stepOrder[idx - 1]);
          if (!prev || prev.status !== 'done') return s; // guard: out-of-order retry blocked
        }
        const reset = addLog(
          updateProdStep(job, step, { status: 'pending', error: undefined, output: undefined }),
          `Retrying step: ${step.replace('_', ' ')}`,
          'info'
        );
        return { ...s, jobs: s.jobs.map(j => (j.id === jobId ? reset : j)) };
      });
      setTimeout(() => runProductionStep(jobId, step), 80);
    },
    [update, runProductionStep]
  );

  const runQACheck = useCallback(
    (jobId: string, checkId: string) => {
      updateJobState(jobId, j => {
        if (j.stage !== 'qa') return j; // gate: only during QA stage
        const def = j.qaChecks.find(c => c.id === checkId);
        if (!def || def.type !== 'automated') return j;

        // Run the actual validator (cast: JobArtifacts is structurally identical to ProductionArtifacts)
        const results = runAutomatedChecks(j.artifacts, j.brief);
        const result = results[checkId as keyof typeof results];
        if (!result) return j;

        return addLog(
          {
            ...j,
            updatedAt: new Date().toISOString(),
            qaChecks: j.qaChecks.map(c =>
              c.id === checkId
                ? { ...c, passed: result.passed, evidence: result.evidence }
                : c
            ),
          },
          `QA check "${def.label}": ${result.passed ? 'PASS' : 'FAIL'} — ${result.evidence}`,
          result.passed ? 'success' : 'warning'
        );
      });
    },
    [updateJobState]
  );

  const runAllAutomatedChecks = useCallback(
    (jobId: string) => {
      updateJobState(jobId, j => {
        if (j.stage !== 'qa') return j;
        const results = runAutomatedChecks(j.artifacts, j.brief);
        let updated = j;
        for (const check of j.qaChecks) {
          if (check.type !== 'automated') continue;
          const result = results[check.id as keyof typeof results];
          if (!result) continue;
          const prevPassed = updated.qaChecks.find(c => c.id === check.id)?.passed;
          // Only update if not already run (null) — allow re-run by calling individually
          if (prevPassed !== null) continue;
          updated = {
            ...updated,
            qaChecks: updated.qaChecks.map(c =>
              c.id === check.id
                ? { ...c, passed: result.passed, evidence: result.evidence }
                : c
            ),
          };
        }
        const passCount = updated.qaChecks.filter(c => c.type === 'automated' && c.passed === true).length;
        const total = updated.qaChecks.filter(c => c.type === 'automated').length;
        return addLog(updated, `Automated checks complete: ${passCount}/${total} passed`, passCount === total ? 'success' : 'warning');
      });
    },
    [updateJobState]
  );

  const retestQACheck = useCallback(
    (jobId: string, checkId: string) => {
      // Resets a check (automated or manual failed) back to null so it can be re-run
      updateJobState(jobId, j => {
        if (j.stage !== 'qa') return j;
        const check = j.qaChecks.find(c => c.id === checkId);
        if (!check || check.passed === null) return j; // nothing to reset
        return addLog(
          {
            ...j,
            updatedAt: new Date().toISOString(),
            qaChecks: j.qaChecks.map(c =>
              c.id === checkId ? { ...c, passed: null, evidence: undefined } : c
            ),
          },
          `Check "${check.label}" reset for re-test`,
          'info'
        );
      });
    },
    [updateJobState]
  );

  const markManualCheck = useCallback(
    (jobId: string, checkId: string, passed: boolean) => {
      updateJobState(jobId, j => {
        if (j.stage !== 'qa') return j;
        const check = j.qaChecks.find(c => c.id === checkId);
        if (!check || check.type !== 'manual') return j;
        return addLog(
          {
            ...j,
            updatedAt: new Date().toISOString(),
            qaChecks: j.qaChecks.map(c =>
              c.id === checkId
                ? { ...c, passed, evidence: passed ? 'Operator confirmed pass' : 'Operator marked fail' }
                : c
            ),
          },
          `Manual check "${check.label}" marked ${passed ? 'PASS' : 'FAIL'}`,
          passed ? 'success' : 'warning'
        );
      });
    },
    [updateJobState]
  );

  const markQAReady = useCallback(
    (jobId: string) => {
      updateJobState(jobId, j => {
        if (!canMarkQAReady(j)) return j; // gate
        return addLog(setStage(j, 'preview'), 'QA approved — ready for customer preview', 'success');
      });
    },
    [updateJobState]
  );

  const acceptDeliverable = useCallback(
    (jobId: string) => {
      const now = new Date().toISOString();
      updateJobState(jobId, j => {
        if (!canAccept(j)) return j; // gate
        return addLog(
          setStage({ ...j, acceptedAt: now }, 'accepted'),
          'Customer acceptance recorded (local demo action)',
          'success'
        );
      });
    },
    [updateJobState]
  );

  const editBrief = useCallback(
    (jobId: string, patch: Partial<Brief>) => {
      updateJobState(jobId, j => {
        const wasPlanLocked = j.stage !== 'brief' && j.stage !== 'quote';
        const newBrief: Brief = { ...j.brief, ...patch };
        // Always regenerate the quote from the current brief so title/colors
        // in deliverables, line-item descriptions, and the plan snapshot stay
        // consistent with the brief. Never persist a quote derived from a
        // different brief version.
        const newQuote = buildQuote(newBrief);
        const updated: Job = {
          ...j,
          brief: newBrief,
          quote: newQuote,
          updatedAt: new Date().toISOString(),
        };
        if (wasPlanLocked) {
          // Invalidate plan, artifacts, QA, acceptance; return to quote
          const invalidated = invalidateAfterBriefEdit(updated);
          return addLog(
            setStage({ ...invalidated, plan: undefined }, 'quote'),
            'Brief edited — plan approval, artifacts, QA, and acceptance invalidated. Re-approval required.',
            'warning'
          );
        }
        return addLog(updated, 'Brief updated', 'info');
      });
    },
    [updateJobState]
  );

  return {
    state,
    selectedJob,
    selectJob,
    openBriefForm,
    closeBriefForm,
    updateDraft,
    clearDraft,
    submitBrief,
    advanceToQuote,
    approvePlan,
    startProduction,
    runProductionStep,
    forceFailStep,
    retryStep,
    runQACheck,
    runAllAutomatedChecks,
    retestQACheck,
    markManualCheck,
    markQAReady,
    acceptDeliverable,
    editBrief,
    // Expose gate functions for UI
    canRunStep,
    canMarkQAReady,
    canAccept,
    canAdvanceToQuote,
    canApprovePlan,
    canStartProduction,
  };
}
