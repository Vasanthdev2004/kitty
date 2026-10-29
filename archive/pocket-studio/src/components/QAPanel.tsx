// ─── QA Panel ─────────────────────────────────────────────────────────────────
// Artifact/config checks run pure validators against produced artifacts.
// Behavioral checks (keyboard/touch/scoring/timer/restart) require manual
// operator review using the embedded playable game below.
import { motion, AnimatePresence } from 'framer-motion';
import { CheckCircle, XCircle, HelpCircle, User, Database, ChevronRight, RefreshCw, ChevronDown, Gamepad2 } from 'lucide-react';
import { useState } from 'react';
import type { Job, QACheck } from '../types';
import type { QACheckDef } from '../productionEngine';
import { QA_CHECK_DEFS } from '../productionEngine';
import { ArcadeGame } from './ArcadeGame';
import { fadeUp } from '../motion';

interface Props {
  job: Job;
  onRunCheck: (id: string) => void;
  onRunAll: () => void;
  onRetestCheck: (id: string) => void;
  onMarkManual: (id: string, passed: boolean) => void;
  onMarkReady: () => void;
  canReady: boolean;
}

export function QAPanel({ job, onRunCheck, onRunAll, onRetestCheck, onMarkManual, onMarkReady, canReady }: Props) {
  const checks = job.qaChecks;
  const [gameOpen, setGameOpen] = useState(false);

  const artifactChecks = checks.filter(c => {
    const def = QA_CHECK_DEFS.find(d => d.id === c.id);
    return def?.section === 'artifact-config';
  });
  const behavioralChecks = checks.filter(c => {
    const def = QA_CHECK_DEFS.find(d => d.id === c.id);
    return def?.section === 'behavior' || def?.type === 'manual';
  });

  const allArtifactRun = artifactChecks.every(c => c.passed !== null);
  const anyFailed = checks.some(c => c.passed === false);
  const passedCount = checks.filter(c => c.passed === true).length;

  return (
    <motion.div {...fadeUp} className="space-y-5">
      {/* Header */}
      <div>
        <span className="text-xs font-700 uppercase tracking-widest" style={{ color: 'var(--mint)', letterSpacing: '0.08em' }}>QA Review</span>
        <h2 className="display text-xl font-700 mt-1" style={{ color: 'var(--ink)' }}>Quality checks</h2>
        <p className="text-sm mt-0.5" style={{ color: 'var(--muted)' }}>
          Artifact checks run against produced config and SVG. Behavioral checks require you to play the game below before marking pass or fail.
        </p>
      </div>

      {/* ── Section 1: Artifact / Config checks ─────────────────────────────── */}
      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <Database size={13} style={{ color: 'var(--muted)' }} />
            <span className="text-xs font-700 uppercase tracking-wide" style={{ color: 'var(--muted)', letterSpacing: '0.06em' }}>
              Artifact / Config checks
            </span>
          </div>
          {!allArtifactRun && (
            <button
              onClick={onRunAll}
              className="text-xs px-3 py-1.5 rounded-lg font-600"
              style={{ background: 'var(--ink)', color: '#fff' }}
            >
              Run all
            </button>
          )}
        </div>
        <p className="text-xs" style={{ color: 'var(--subtle)' }}>
          These validators assert the generated config JSON and brand SVG are structurally correct. They do not verify runtime game behavior.
        </p>
        {artifactChecks.map(check => {
          const def = QA_CHECK_DEFS.find(d => d.id === check.id);
          return (
            <AutomatedCheckRow
              key={check.id}
              check={check}
              def={def}
              onRun={() => onRunCheck(check.id)}
              onRetest={() => onRetestCheck(check.id)}
            />
          );
        })}
      </section>

      {/* ── Section 2: Behavioral checks (manual, with embedded game) ──────── */}
      <section className="space-y-2">
        <div className="flex items-center gap-1.5">
          <User size={13} style={{ color: 'var(--muted)' }} />
          <span className="text-xs font-700 uppercase tracking-wide" style={{ color: 'var(--muted)', letterSpacing: '0.06em' }}>
            Behavioral checks — manual review
          </span>
        </div>
        <p className="text-xs" style={{ color: 'var(--subtle)' }}>
          Open the game below and verify each behavior before marking pass or fail. Retest resets a check to pending.
        </p>

        {/* Embedded game for QA review */}
        <div className="rounded-2xl overflow-hidden" style={{ border: '1px solid var(--border)' }}>
          <button
            onClick={() => setGameOpen(v => !v)}
            className="w-full flex items-center gap-2.5 px-4 py-3 text-left"
            style={{ background: 'var(--surface-muted)' }}
          >
            <Gamepad2 size={15} style={{ color: 'var(--coral)', flexShrink: 0 }} />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-600" style={{ color: 'var(--ink)' }}>
                {job.brief.gameTitle} — Playable preview for QA
              </p>
              <p className="text-xs" style={{ color: 'var(--muted)' }}>
                {gameOpen ? 'Click to collapse game' : 'Click to open and play — required for behavioral checks'}
              </p>
            </div>
            <ChevronDown size={14} style={{ color: 'var(--muted)', transform: gameOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.18s', flexShrink: 0 }} />
          </button>
          <AnimatePresence>
            {gameOpen && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.18 }}
                style={{ overflow: 'hidden' }}
              >
                <div className="p-3" style={{ background: 'var(--surface)' }}>
                  <ArcadeGame
                    gameTitle={job.brief.gameTitle}
                    clientName={job.brief.clientName}
                    colors={job.brief.colors}
                    embedded
                  />
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {behavioralChecks.map(check => {
          const def = QA_CHECK_DEFS.find(d => d.id === check.id);
          return (
            <ManualCheckRow
              key={check.id}
              check={check}
              def={def}
              onPass={() => onMarkManual(check.id, true)}
              onFail={() => onMarkManual(check.id, false)}
              onRetest={() => onRetestCheck(check.id)}
            />
          );
        })}
      </section>

      {/* Summary bar */}
      <div className="rounded-xl p-3 flex items-center justify-between gap-2" style={{ background: 'var(--surface-muted)', border: '1px solid var(--border)' }}>
        <span className="text-xs" style={{ color: 'var(--muted)' }}>
          {passedCount}/{checks.length} checks passed
        </span>
        {anyFailed && (
          <span className="text-xs font-600" style={{ color: 'var(--danger)' }}>
            Failed items can be retested
          </span>
        )}
        {!anyFailed && allArtifactRun && !canReady && (
          <span className="text-xs" style={{ color: 'var(--muted)' }}>Complete behavioral review above</span>
        )}
      </div>

      {canReady && (
        <button
          onClick={onMarkReady}
          className="w-full flex items-center justify-center gap-2 py-3.5 rounded-2xl font-600 text-sm"
          style={{ background: 'var(--mint)', color: '#fff' }}
        >
          <CheckCircle size={16} />
          QA approved — open customer preview
          <ChevronRight size={16} />
        </button>
      )}
    </motion.div>
  );
}

// ── Automated check row (artifact/config) ─────────────────────────────────────

function AutomatedCheckRow({
  check, def, onRun, onRetest,
}: {
  check: QACheck;
  def?: QACheckDef;
  onRun: () => void;
  onRetest: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const isConfigOnly = def?.id === 'qa-config-scoring' || def?.id === 'qa-config-restart';

  return (
    <div
      className="rounded-xl overflow-hidden"
      style={{
        border: `1px solid ${check.passed === true ? 'rgba(26,128,71,0.2)' : check.passed === false ? 'rgba(186,43,76,0.2)' : 'var(--border)'}`,
        background: check.passed === true ? 'rgba(26,128,71,0.04)' : check.passed === false ? 'rgba(186,43,76,0.04)' : 'var(--surface)',
      }}
    >
      <div className="flex items-center gap-2.5 px-3 py-2.5">
        <StatusIcon passed={check.passed} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <p className="text-sm font-500" style={{ color: 'var(--ink-2)' }}>{check.label}</p>
            {isConfigOnly && (
              <span className="text-xs px-1.5 py-0.5 rounded" style={{ background: 'rgba(16,97,166,0.1)', color: '#1061a6', fontSize: 10, fontWeight: 600 }}>
                config-level only
              </span>
            )}
          </div>
          {def && (
            <p className="text-xs mt-0.5" style={{ color: 'var(--subtle)' }}>{def.description}</p>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {check.passed === null && (
            <button
              onClick={onRun}
              className="text-xs px-2 py-1 rounded-lg font-600"
              style={{ background: 'var(--ink)', color: '#fff' }}
            >
              Run
            </button>
          )}
          {check.passed !== null && (
            <button
              onClick={onRetest}
              title="Reset and re-run"
              className="flex items-center gap-1 text-xs px-2 py-1 rounded-lg"
              style={{ background: 'var(--surface-muted)', color: 'var(--muted)', border: '1px solid var(--border)' }}
            >
              <RefreshCw size={10} />
              Retest
            </button>
          )}
          {check.evidence && (
            <button
              onClick={() => setExpanded(e => !e)}
              className="p-1 rounded"
              style={{ color: 'var(--subtle)' }}
              aria-label="Toggle evidence"
            >
              <ChevronDown size={13} style={{ transform: expanded ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }} />
            </button>
          )}
        </div>
      </div>
      <AnimatePresence>
        {expanded && check.evidence && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="px-3 pb-2.5"
          >
            <p className="mono text-xs px-2 py-1.5 rounded-lg" style={{ background: 'var(--surface-muted)', color: 'var(--ink-2)', wordBreak: 'break-all' }}>
              {check.evidence}
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ── Manual check row (behavioral) ─────────────────────────────────────────────

function ManualCheckRow({
  check, def, onPass, onFail, onRetest,
}: {
  check: QACheck;
  def?: QACheckDef;
  onPass: () => void;
  onFail: () => void;
  onRetest: () => void;
}) {
  return (
    <div
      className="rounded-xl px-3 py-2.5"
      style={{
        border: `1px solid ${check.passed === true ? 'rgba(26,128,71,0.2)' : check.passed === false ? 'rgba(186,43,76,0.2)' : 'var(--border)'}`,
        background: check.passed === true ? 'rgba(26,128,71,0.04)' : check.passed === false ? 'rgba(186,43,76,0.04)' : 'var(--surface)',
      }}
    >
      <div className="flex items-start gap-2.5">
        <div className="mt-0.5"><StatusIcon passed={check.passed} /></div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <p className="text-sm font-500" style={{ color: 'var(--ink-2)' }}>{check.label}</p>
            <span className="text-xs px-1.5 py-0.5 rounded" style={{ background: 'var(--surface-muted)', color: 'var(--muted)', fontSize: 10 }}>
              manual
            </span>
          </div>
          {def && (
            <p className="text-xs mt-0.5" style={{ color: 'var(--subtle)' }}>{def.description}</p>
          )}
          {check.evidence && (
            <p className="text-xs mt-1 mono" style={{ color: check.passed ? 'var(--success)' : 'var(--danger)' }}>
              {check.evidence}
            </p>
          )}
        </div>
        <div className="flex gap-1 shrink-0 mt-0.5">
          {check.passed === null ? (
            <>
              <button onClick={onPass} className="text-xs px-2 py-1 rounded-lg font-600" style={{ background: 'rgba(26,128,71,0.12)', color: 'var(--success)' }}>
                Pass
              </button>
              <button onClick={onFail} className="text-xs px-2 py-1 rounded-lg font-600" style={{ background: 'rgba(186,43,76,0.1)', color: 'var(--danger)' }}>
                Fail
              </button>
            </>
          ) : (
            <button
              onClick={onRetest}
              className="flex items-center gap-1 text-xs px-2 py-1 rounded-lg"
              style={{ background: 'var(--surface-muted)', color: 'var(--muted)', border: '1px solid var(--border)' }}
            >
              <RefreshCw size={10} />
              Retest
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function StatusIcon({ passed }: { passed: boolean | null }) {
  if (passed === true) return <CheckCircle size={15} style={{ color: 'var(--success)', flexShrink: 0 }} />;
  if (passed === false) return <XCircle size={15} style={{ color: 'var(--danger)', flexShrink: 0 }} />;
  return <HelpCircle size={15} style={{ color: 'var(--subtle)', flexShrink: 0 }} />;
}
