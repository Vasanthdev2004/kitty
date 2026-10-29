// ─── Production Panel – Real local artifact builds ─────────────────────────
import { motion, AnimatePresence } from 'framer-motion';
import { CheckCircle, XCircle, Loader2, AlertTriangle, RefreshCw, PlayCircle } from 'lucide-react';
import { useState } from 'react';
import type { Job, ProductionStep } from '../types';
import { canRunStep as gateCanRunStep } from '../store';
import { fadeUp } from '../motion';

interface Props {
  job: Job;
  onRunStep: (step: ProductionStep) => void;
  onForceFailStep: (step: ProductionStep) => void;
  onRetryStep: (step: ProductionStep) => void;
}

const STEP_META: { step: ProductionStep; label: string; description: string }[] = [
  {
    step: 'art',
    label: 'Brand art generation',
    description: 'Build SVG brand mark from client name, primary/accent colors, compute contrast ratio',
  },
  {
    step: 'game_build',
    label: 'Game config build',
    description: 'Generate game config JSON — mechanic, scoring values, brand colors, schema version',
  },
  {
    step: 'qa_checks',
    label: 'Artifact verification',
    description: 'Confirm brand art and game config are present before QA stage validators run',
  },
  {
    step: 'package',
    label: 'Session manifest',
    description: 'Record all produced artifacts and step timestamps in a local session manifest',
  },
];

export function ProductionPanel({ job, onRunStep, onForceFailStep, onRetryStep }: Props) {
  const [expandedArtifact, setExpandedArtifact] = useState<ProductionStep | null>(null);
  const hasAnyFailed = job.production.some(p => p.status === 'failed');

  return (
    <motion.div {...fadeUp} className="space-y-5">
      <div>
        <span className="text-xs font-700 uppercase tracking-widest" style={{ color: 'var(--coral)', letterSpacing: '0.08em' }}>Production</span>
        <h2 className="display text-xl font-700 mt-1" style={{ color: 'var(--ink)' }}>Building {job.brief.gameTitle}</h2>
        <p className="text-sm mt-0.5" style={{ color: 'var(--muted)' }}>
          Local template operations — no external calls, no files written to disk
        </p>
      </div>

      <div className="flex items-center gap-2 rounded-xl px-4 py-2.5" style={{ background: 'rgba(186,43,76,0.07)', border: '1px dashed rgba(186,43,76,0.3)' }}>
        <AlertTriangle size={13} style={{ color: '#ba2b4c', flexShrink: 0 }} />
        <span className="text-xs flex-1" style={{ color: '#7a2030' }}>
          <strong>Demo control:</strong> "Test fail" injects a failure on any non-completed step; "Retry" re-runs only that step
        </span>
      </div>

      <div className="space-y-3">
        {STEP_META.map(({ step, label, description }) => {
          const rec = job.production.find(p => p.step === step);
          const status = rec?.status ?? 'pending';
          const canRun = gateCanRunStep(job, step);
          const hasArtifact = getArtifactForStep(job, step);
          const isExpanded = expandedArtifact === step;

          return (
            <div key={step} className="rounded-2xl overflow-hidden" style={{
              border: `1px solid ${status === 'running' ? 'rgba(232,81,42,0.25)' : status === 'done' ? 'rgba(26,128,71,0.2)' : status === 'failed' ? 'rgba(186,43,76,0.2)' : 'var(--border)'}`,
              background: status === 'running' ? 'rgba(232,81,42,0.04)' : status === 'done' ? 'rgba(26,128,71,0.04)' : status === 'failed' ? 'rgba(186,43,76,0.04)' : 'var(--surface)',
              transition: 'background 0.18s, border-color 0.18s',
            }}>
              <div className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="flex items-center gap-2.5 min-w-0">
                  <StepIcon status={status} />
                  <div className="min-w-0">
                    <p className="text-sm font-600 truncate" style={{ color: 'var(--ink)' }}>{label}</p>
                    <p className="text-xs" style={{ color: 'var(--muted)' }}>{description}</p>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  {status === 'failed' && (
                    <button
                      onClick={() => onRetryStep(step)}
                      className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-600"
                      style={{ background: 'var(--ink)', color: '#fff' }}
                    >
                      <RefreshCw size={11} />Retry
                    </button>
                  )}
                  {(status === 'running' || status === 'pending') && !canRun && status === 'pending' && (
                    <span className="text-xs" style={{ color: 'var(--subtle)' }}>Waiting</span>
                  )}
                  {(status === 'running' || (status === 'pending' && canRun)) && (
                    <button
                      onClick={() => onForceFailStep(step)}
                      className="px-2 py-1 rounded-lg text-xs font-500"
                      style={{ background: 'rgba(186,43,76,0.1)', color: '#ba2b4c', border: '1px solid rgba(186,43,76,0.2)' }}
                      title="Inject test failure"
                    >
                      Test fail
                    </button>
                  )}
                  {canRun && (
                    <button
                      onClick={() => onRunStep(step)}
                      className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-600"
                      style={{ background: '#e8512a', color: '#fff' }}
                    >
                      <PlayCircle size={11} />Run
                    </button>
                  )}
                </div>
              </div>

              <AnimatePresence>
                {rec?.output && status === 'done' && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    className="px-4 pb-3"
                  >
                    <p className="text-xs" style={{ color: 'var(--success)' }}>
                      {rec.output}
                      {rec.completedAt && <span className="mono ml-2 opacity-50">{new Date(rec.completedAt).toLocaleTimeString()}</span>}
                    </p>
                    {hasArtifact && (
                      <div className="mt-2">
                        <button
                          onClick={() => setExpandedArtifact(isExpanded ? null : step)}
                          className="text-xs font-500 flex items-center gap-1"
                          style={{ color: 'var(--muted)' }}
                        >
                          {isExpanded ? '▲' : '▼'} View artifact
                        </button>
                        <AnimatePresence>
                          {isExpanded && (
                            <motion.div
                              initial={{ opacity: 0, height: 0 }}
                              animate={{ opacity: 1, height: 'auto' }}
                              exit={{ opacity: 0, height: 0 }}
                              className="mt-1"
                            >
                              <ArtifactPreview job={job} step={step} />
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </div>
                    )}
                  </motion.div>
                )}
                {rec?.error && status === 'failed' && (
                  <motion.p
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    className="px-4 pb-3 text-xs"
                    style={{ color: 'var(--danger)' }}
                  >
                    {rec.error}
                  </motion.p>
                )}
              </AnimatePresence>
            </div>
          );
        })}
      </div>

      {hasAnyFailed && (
        <p className="text-xs text-center" style={{ color: 'var(--danger)' }}>
          Failed steps can be retried individually. Previous steps must be complete before retrying a later step.
        </p>
      )}
    </motion.div>
  );
}

function getArtifactForStep(job: Job, step: ProductionStep): boolean {
  if (step === 'art') return !!job.artifacts.brandArtSvg;
  if (step === 'game_build') return !!job.artifacts.gameConfigJson;
  if (step === 'package') return !!job.artifacts.manifestJson;
  return false;
}

function ArtifactPreview({ job, step }: { job: Job; step: ProductionStep }) {
  if (step === 'art' && job.artifacts.brandArtSvg) {
    return (
      <div className="flex items-center gap-3 p-2 rounded-xl" style={{ background: 'var(--surface-muted)' }}>
        <div
          className="w-12 h-12 rounded-xl shrink-0"
          dangerouslySetInnerHTML={{ __html: job.artifacts.brandArtSvg }}
          aria-label="Generated brand mark SVG"
        />
        <p className="mono text-xs" style={{ color: 'var(--muted)', wordBreak: 'break-all' }}>
          Inline SVG — {job.artifacts.brandArtSvg.length} chars
        </p>
      </div>
    );
  }
  if ((step === 'game_build' && job.artifacts.gameConfigJson) || (step === 'package' && job.artifacts.manifestJson)) {
    const json = step === 'game_build' ? job.artifacts.gameConfigJson! : job.artifacts.manifestJson!;
    return (
      <pre className="mono text-xs p-2 rounded-xl overflow-auto max-h-48" style={{ background: 'var(--surface-muted)', color: 'var(--ink-2)', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
        {json}
      </pre>
    );
  }
  return null;
}

function StepIcon({ status }: { status: string }) {
  if (status === 'done') return <CheckCircle size={18} style={{ color: 'var(--success)', flexShrink: 0 }} />;
  if (status === 'failed') return <XCircle size={18} style={{ color: 'var(--danger)', flexShrink: 0 }} />;
  if (status === 'running') return <Loader2 size={18} style={{ color: 'var(--coral)', flexShrink: 0, animation: 'spin 1s linear infinite' }} />;
  return <div style={{ width: 18, height: 18, borderRadius: 9, border: '2px solid var(--border-strong)', flexShrink: 0 }} />;
}
