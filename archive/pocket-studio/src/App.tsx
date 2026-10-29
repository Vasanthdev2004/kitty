// ─── Pocket Studio – Main App ───────────────────────────────────────────────
import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, Briefcase, Activity, Settings2, ChevronRight, Layers } from 'lucide-react';
import { BriefEditStrip } from './components/BriefEditStrip';
import { useAppStore } from './store';
import { StudioFloor } from './components/StudioFloor';
import { BriefPanel } from './components/BriefPanel';
import { QuotePanel } from './components/QuotePanel';
import { ProductionPanel } from './components/ProductionPanel';
import { QAPanel } from './components/QAPanel';
import { PreviewPanel } from './components/PreviewPanel';
import { ProvidersPanel } from './components/ProvidersPanel';
import { ActivityLog } from './components/ActivityLog';
import { NewBriefForm } from './components/NewBriefForm';
import type { WorkflowStage } from './types';
import { fadeUp } from './motion';
import { toast } from 'sonner';

type SideTab = 'jobs' | 'activity' | 'providers';

const STAGE_LABELS: Record<WorkflowStage, string> = {
  brief: 'Brief', quote: 'Quote', approved: 'Approved',
  production: 'Production', qa: 'QA', preview: 'Preview', accepted: 'Accepted',
};

const STAGE_COLORS: Record<WorkflowStage, string> = {
  brief: '#9a96a6', quote: '#e88a2a', approved: '#2ec4a0',
  production: '#e8512a', qa: '#1061a6', preview: '#2ec4a0', accepted: '#1a8047',
};

export default function App() {
  const store = useAppStore();
  const { state, selectedJob: job } = store;
  const [sideTab, setSideTab] = useState<SideTab>('jobs');

  // isComputing = a production step is actively running OR a QA check is running
  const isComputing = !!(
    job?.production.some(p => p.status === 'running') ||
    (job?.stage === 'qa' && job.qaChecks.some(c => c.type === 'automated' && c.passed === null && job.qaChecks.some(c2 => c2.passed !== null)))
  );

  const canReady = job ? store.canMarkQAReady(job) : false;

  // Room click: informational navigation (no workflow change)
  function handleRoomClick(room: 'desk' | 'build' | 'qa') {
    if (!job) return;
    const stageForRoom: Record<'desk' | 'build' | 'qa', string> = {
      desk: 'Brief / Quote',
      build: 'Production',
      qa: 'QA / Testing',
    };
    const currentRoomStages: Record<'desk' | 'build' | 'qa', WorkflowStage[]> = {
      desk: ['brief', 'quote', 'approved'],
      build: ['production'],
      qa: ['qa', 'preview', 'accepted'],
    };
    if (currentRoomStages[room].includes(job.stage)) {
      toast.info(`Already in ${stageForRoom[room]}`);
    } else {
      const stageOrder: WorkflowStage[] = ['brief', 'quote', 'approved', 'production', 'qa', 'preview', 'accepted'];
      const jobIdx = stageOrder.indexOf(job.stage);
      const roomIdx = Math.max(...currentRoomStages[room].map(s => stageOrder.indexOf(s)));
      if (jobIdx < roomIdx) {
        toast.info(`${stageForRoom[room]} is ahead — complete current stage first`);
      } else {
        toast.info(`${stageForRoom[room]} is complete — current stage is ${STAGE_LABELS[job.stage]}`);
      }
    }
  }

  function getMainPanel() {
    if (!job) return <EmptyState onNew={store.openBriefForm} />;
    switch (job.stage) {
      case 'brief':
        return (
          <BriefPanel
            job={job}
            onAdvanceToQuote={() => store.advanceToQuote(job.id)}
            onEditBrief={patch => store.editBrief(job.id, patch)}
            canAdvance={store.canAdvanceToQuote(job)}
          />
        );
      case 'quote':
      case 'approved':
        return (
          <>
            <BriefEditStrip job={job} onEditBrief={patch => store.editBrief(job.id, patch)} />
            <QuotePanel
              job={job}
              onApprovePlan={() => store.approvePlan(job.id)}
              onStartProduction={() => store.startProduction(job.id)}
            />
          </>
        );
      case 'production':
        return (
          <>
            <BriefEditStrip job={job} onEditBrief={patch => store.editBrief(job.id, patch)} />
            <ProductionPanel
              job={job}
              onRunStep={step => store.runProductionStep(job.id, step)}
              onForceFailStep={step => store.forceFailStep(job.id, step)}
              onRetryStep={step => store.retryStep(job.id, step)}
            />
          </>
        );
      case 'qa':
        return (
          <>
            <BriefEditStrip job={job} onEditBrief={patch => store.editBrief(job.id, patch)} />
            <QAPanel
              job={job}
              onRunCheck={id => store.runQACheck(job.id, id)}
              onRunAll={() => store.runAllAutomatedChecks(job.id)}
              onRetestCheck={id => store.retestQACheck(job.id, id)}
              onMarkManual={(id, passed) => store.markManualCheck(job.id, id, passed)}
              onMarkReady={() => store.markQAReady(job.id)}
              canReady={canReady}
            />
          </>
        );
      case 'preview':
      case 'accepted':
        return (
          <>
            <BriefEditStrip job={job} onEditBrief={patch => store.editBrief(job.id, patch)} />
            <PreviewPanel
              job={job}
              onAccept={() => store.acceptDeliverable(job.id)}
            />
          </>
        );
      default:
        return null;
    }
  }

  return (
    <div className="min-h-dvh flex flex-col" style={{ background: 'var(--bg-gradient)' }}>
      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <header
        className="sticky top-0 z-30"
        style={{ background: 'rgba(250,248,244,0.92)', backdropFilter: 'blur(12px)', borderBottom: '1px solid var(--border)' }}
      >
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl flex items-center justify-center" style={{ background: 'var(--ink)' }}>
              <Layers size={16} color="#fff" />
            </div>
            <div>
              <h1 className="display text-base font-700 leading-tight" style={{ color: 'var(--ink)' }}>Pocket Studio</h1>
              <p className="text-xs leading-none" style={{ color: 'var(--muted)' }}>Small studio. Playable launches.</p>
            </div>
          </div>
          <button
            onClick={store.openBriefForm}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl font-600 text-sm"
            style={{ background: 'var(--coral)', color: '#fff' }}
          >
            <Plus size={14} />
            New brief
          </button>
        </div>
      </header>

      {/* ── Studio Floor ────────────────────────────────────────────────────── */}
      <div className="w-full px-4 pt-5 pb-2 max-w-5xl mx-auto">
        <StudioFloor stage={job?.stage ?? 'brief'} isComputing={isComputing} onRoomClick={handleRoomClick} />
      </div>

      {/* ── Main content ──────────────────────────────────────────────────── */}
      <div className="flex-1 max-w-5xl mx-auto w-full px-4 pb-8">
        <div className="flex gap-5 items-start">

          {/* ── Left sidebar ─────────────────────────────────────────────── */}
          <div className="hidden md:block w-64 shrink-0">
            <div className="rounded-2xl overflow-hidden" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
              <div className="flex border-b" style={{ borderColor: 'var(--border)' }}>
                {([
                  { id: 'jobs' as SideTab, icon: <Briefcase size={13} />, label: 'Jobs' },
                  { id: 'activity' as SideTab, icon: <Activity size={13} />, label: 'Activity' },
                  { id: 'providers' as SideTab, icon: <Settings2 size={13} />, label: 'Providers' },
                ]).map(tab => (
                  <button
                    key={tab.id}
                    onClick={() => setSideTab(tab.id)}
                    className="flex-1 flex items-center justify-center gap-1 py-2.5 text-xs font-600"
                    style={{
                      color: sideTab === tab.id ? 'var(--ink)' : 'var(--muted)',
                      borderBottom: sideTab === tab.id ? '2px solid var(--coral)' : '2px solid transparent',
                      background: 'none',
                    }}
                  >
                    {tab.icon}{tab.label}
                  </button>
                ))}
              </div>
              <div className="p-3">
                {sideTab === 'jobs' && (
                  <JobList
                    jobs={state.jobs}
                    selectedId={state.selectedJobId}
                    onSelect={store.selectJob}
                  />
                )}
                {sideTab === 'activity' && <ActivityLog entries={job?.activityLog ?? []} />}
                {sideTab === 'providers' && <p className="text-xs py-1" style={{ color: 'var(--muted)' }}>See Providers panel on the right.</p>}
              </div>
            </div>
          </div>

          {/* ── Main panel ──────────────────────────────────────────────── */}
          <div className="flex-1 min-w-0">
            {job && (
              <div className="flex items-center gap-1.5 mb-4 flex-wrap">
                <span className="text-xs font-500" style={{ color: 'var(--muted)' }}>{job.brief.clientName}</span>
                <ChevronRight size={12} style={{ color: 'var(--subtle)' }} />
                <span className="text-xs font-500" style={{ color: 'var(--muted)' }}>{job.brief.gameTitle}</span>
                <ChevronRight size={12} style={{ color: 'var(--subtle)' }} />
                <span className="text-xs font-700 px-2 py-0.5 rounded-full" style={{ background: `${STAGE_COLORS[job.stage]}18`, color: STAGE_COLORS[job.stage] }}>
                  {STAGE_LABELS[job.stage]}
                </span>
              </div>
            )}

            <AnimatePresence mode="wait">
              <motion.div key={`${job?.id}-${job?.stage}`} {...fadeUp}>
                {getMainPanel()}
              </motion.div>
            </AnimatePresence>

            {/* Mobile bottom tabs */}
            <div className="md:hidden mt-6 rounded-2xl overflow-hidden" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
              <div className="flex border-b" style={{ borderColor: 'var(--border)' }}>
                {(['jobs', 'activity', 'providers'] as SideTab[]).map(tab => (
                  <button
                    key={tab}
                    onClick={() => setSideTab(tab)}
                    className="flex-1 py-2.5 text-xs font-600 capitalize"
                    style={{ color: sideTab === tab ? 'var(--ink)' : 'var(--muted)', borderBottom: sideTab === tab ? '2px solid var(--coral)' : '2px solid transparent' }}
                  >
                    {tab}
                  </button>
                ))}
              </div>
              <div className="p-3">
                {sideTab === 'jobs' && <JobList jobs={state.jobs} selectedId={state.selectedJobId} onSelect={store.selectJob} />}
                {sideTab === 'activity' && <ActivityLog entries={job?.activityLog ?? []} />}
                {sideTab === 'providers' && <ProvidersPanel />}
              </div>
            </div>
          </div>

          {/* ── Right: providers ────────────────────────────────────────── */}
          <div className="hidden lg:block w-56 shrink-0">
            <ProvidersPanel />
          </div>
        </div>
      </div>

      {/* ── New Brief Modal ──────────────────────────────────────────────── */}
      <AnimatePresence>
        {state.showBriefForm && (
          <NewBriefForm
            draft={state.draftBrief ?? {}}
            onUpdate={store.updateDraft}
            onSubmit={store.submitBrief}
            onCancel={store.closeBriefForm}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

function JobList({ jobs, selectedId, onSelect }: { jobs: import('./types').Job[]; selectedId: string | null; onSelect: (id: string) => void }) {
  if (jobs.length === 0) return <p className="text-xs text-center py-4" style={{ color: 'var(--subtle)' }}>No jobs yet</p>;
  return (
    <div className="space-y-1.5">
      {jobs.map(j => (
        <button
          key={j.id}
          onClick={() => onSelect(j.id)}
          className="w-full text-left rounded-xl px-3 py-2.5"
          style={{
            background: j.id === selectedId ? 'var(--surface-muted)' : 'transparent',
            border: j.id === selectedId ? '1px solid var(--border-strong)' : '1px solid transparent',
          }}
        >
          <div className="flex items-center justify-between gap-1">
            <p className="text-xs font-600 truncate" style={{ color: 'var(--ink)' }}>{j.brief.clientName}</p>
            <span className="text-xs px-1.5 py-0.5 rounded-full shrink-0" style={{ background: `${STAGE_COLORS[j.stage]}22`, color: STAGE_COLORS[j.stage], fontSize: 10 }}>
              {STAGE_LABELS[j.stage]}
            </span>
          </div>
          <p className="text-xs mt-0.5 truncate" style={{ color: 'var(--muted)' }}>{j.brief.gameTitle}</p>
        </button>
      ))}
    </div>
  );
}

function EmptyState({ onNew }: { onNew: () => void }) {
  return (
    <motion.div {...fadeUp} className="text-center py-16 space-y-4">
      <div className="w-16 h-16 rounded-2xl mx-auto flex items-center justify-center" style={{ background: 'var(--surface-muted)' }}>
        <Layers size={28} style={{ color: 'var(--muted)' }} />
      </div>
      <div>
        <h3 className="display text-lg font-700" style={{ color: 'var(--ink)' }}>No job selected</h3>
        <p className="text-sm mt-1" style={{ color: 'var(--muted)' }}>Start a new brief to create a branded mini-game.</p>
      </div>
      <button onClick={onNew} className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl font-600 text-sm" style={{ background: 'var(--ink)', color: '#fff' }}>
        <Plus size={15} />Start new brief
      </button>
    </motion.div>
  );
}
