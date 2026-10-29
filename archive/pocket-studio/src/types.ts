// ─── Pocket Studio – Core Types ────────────────────────────────────────────

export type WorkflowStage =
  | 'brief'
  | 'quote'
  | 'approved'
  | 'production'
  | 'qa'
  | 'preview'
  | 'accepted';

export type ProductionStep =
  | 'art'
  | 'game_build'
  | 'qa_checks'
  | 'package';

export type ProductionStepStatus = 'pending' | 'running' | 'done' | 'failed';

export interface BrandColors {
  primary: string;
  accent: string;
}

export interface Brief {
  id: string;
  clientName: string;
  audience: string;
  goal: string;
  gameTitle: string;
  colors: BrandColors;
  localImageDataUrl?: string;
}

export interface QuoteLineItem {
  label: string;
  description: string;
  amount: number; // USD cents, display only
}

export interface Quote {
  items: QuoteLineItem[];
  totalCents: number;
  deliverables: string[];
  timeline: string;
  limitations: string[];
  disclaimer: string;
}

export interface PlanVersion {
  version: number;
  lockedAt: string;
  briefSnapshot: Brief;
  quoteSnapshot: Quote;
}

export interface ProductionStepRecord {
  step: ProductionStep;
  status: ProductionStepStatus;
  startedAt?: string;
  completedAt?: string;
  output?: string;   // human-readable description of what was produced
  error?: string;
}

// JobArtifacts is identical to ProductionArtifacts (same 3 optional string fields).
// Defined here to avoid a circular import; must stay in sync with ProductionArtifacts.
export interface JobArtifacts {
  brandArtSvg?: string;       // inline SVG string (from productionEngine.buildBrandArt)
  gameConfigJson?: string;    // JSON string of GameConfigArtifact
  manifestJson?: string;      // JSON string of ManifestArtifact
}

export interface QACheck {
  id: string;
  label: string;
  type: 'automated' | 'manual';
  passed: boolean | null; // null = not yet run/reviewed
  evidence?: string;      // what was actually checked (populated by validators)
}

export interface ActivityEntry {
  id: string;
  timestamp: string;
  message: string;
  kind: 'info' | 'success' | 'warning' | 'error';
}

export interface Job {
  id: string;
  createdAt: string;
  updatedAt: string;
  stage: WorkflowStage;
  brief: Brief;
  quote: Quote;
  plan?: PlanVersion;
  production: ProductionStepRecord[];
  artifacts: JobArtifacts;
  qaChecks: QACheck[];
  activityLog: ActivityEntry[];
  acceptedAt?: string;
  isDraft: boolean;
}

export interface AppState {
  jobs: Job[];
  selectedJobId: string | null;
  showBriefForm: boolean;
  draftBrief: Partial<Brief> | null;
}
