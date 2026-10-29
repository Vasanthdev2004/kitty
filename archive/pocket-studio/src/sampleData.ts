// ─── Pocket Studio – Sample Data & Template Builders ───────────────────────
import type { Job, Brief, Quote, ProductionStepRecord, ActivityEntry } from './types';
import { QA_CHECK_DEFS } from './productionEngine';

export function buildOrbitBrief(): Brief {
  return {
    id: 'brief-orbit-001',
    clientName: 'Orbit Soda',
    audience: 'Gen Z soda enthusiasts, ages 16-28',
    goal: 'Boost brand awareness and social sharing for summer campaign',
    gameTitle: 'Orbit Catch',
    colors: { primary: '#0f2e58', accent: '#b8e04a' },
  };
}

export function buildQuote(brief: Brief): Quote {
  return {
    items: [
      { label: 'Brand identity prep', description: 'SVG mark generation, color validation, typography config', amount: 19900 },
      { label: 'Game template build', description: 'Arcade collector template — one mechanic, 30s run, in-browser only', amount: 39900 },
      { label: 'QA & compatibility', description: 'Automated config/SVG/scoring checks + operator manual review', amount: 14900 },
      { label: 'Session delivery', description: 'Playable preview + session manifest (local, no external hosting)', amount: 9900 },
    ],
    totalCents: 84600,
    deliverables: [
      `Playable ${brief.gameTitle} branded mini-game (in-browser session)`,
      'Brand mark SVG (generated in-browser, viewable in QA)',
      'Game config JSON (generated in-browser, viewable in QA)',
      'Session manifest recording all produced artifacts',
    ],
    timeline: '3 business days from plan approval',
    limitations: [
      'Template-based: one game mechanic only (horizontal collector)',
      'In-browser session only — no file download, no hosted URL, no ZIP',
      'Up to 2 brand color revisions included',
      'No server-side leaderboard in this tier',
    ],
    disclaimer: 'Sample quote — no charge. This quote is for demonstration purposes only. No payment integration is connected.',
  };
}

export function buildInitialProduction(): ProductionStepRecord[] {
  return [
    { step: 'art', status: 'pending' },
    { step: 'game_build', status: 'pending' },
    { step: 'qa_checks', status: 'pending' },
    { step: 'package', status: 'pending' },
  ];
}

export function buildInitialQA() {
  // Derive directly from QA_CHECK_DEFS so names stay in sync
  return QA_CHECK_DEFS.map(def => ({
    id: def.id,
    label: def.label,
    type: def.type,
    passed: null as boolean | null,
    evidence: undefined as string | undefined,
  }));
}

function logEntry(message: string, kind: ActivityEntry['kind']): ActivityEntry {
  return {
    id: `log-seed-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: new Date(Date.now() - 86400000).toISOString(),
    message,
    kind,
  };
}

export function buildSampleJob(): Job {
  const brief = buildOrbitBrief();
  const quote = buildQuote(brief);
  return {
    id: 'job-orbit-001',
    createdAt: new Date(Date.now() - 86400000 * 2).toISOString(),
    updatedAt: new Date(Date.now() - 3600000).toISOString(),
    stage: 'brief',
    brief,
    quote,
    production: [],
    artifacts: {},
    qaChecks: [],
    isDraft: false,
    activityLog: [
      logEntry('Sample job seeded — Orbit Soda (demo client)', 'info'),
      logEntry('Brief generated from Orbit Soda brand profile', 'info'),
      logEntry('Quote calculated from template pricing', 'success'),
    ],
  };
}
