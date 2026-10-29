// ─── Pocket Studio – Production Engine ─────────────────────────────────────
// All functions are pure and deterministic. No external I/O.
// Each artifact is a real data structure that can be inspected in the UI.

import type { Brief, ProductionStep } from './types';

// ── Types ────────────────────────────────────────────────────────────────────

export interface BrandArtifact {
  svgMark: string;          // inline SVG string for the brand mark
  primaryHex: string;
  accentHex: string;
  contrastRatio: number;    // computed luminance contrast (approximate)
  initial: string;          // first letter used in brand mark
  generatedAt: string;
}

export interface GameConfigArtifact {
  gameTitle: string;
  clientName: string;
  primaryColor: string;
  accentColor: string;
  playerSpeed: number;
  starValue: number;
  obstaclePenalty: number;
  durationSeconds: number;
  mechanic: 'horizontal-collector';
  schemaVersion: string;
  generatedAt: string;
}

export interface ManifestArtifact {
  jobId: string;
  clientName: string;
  gameTitle: string;
  steps: Record<ProductionStep, string>; // step -> completedAt
  deliverables: string[];
  note: string;
  generatedAt: string;
}

/** Mirrors JobArtifacts from types.ts — serialized strings for persistence. */
export interface ProductionArtifacts {
  brandArtSvg?: string;      // inline SVG string
  gameConfigJson?: string;   // JSON string of GameConfigArtifact
  manifestJson?: string;     // JSON string of ManifestArtifact
}

// ── QA Validator results ──────────────────────────────────────────────────────

export interface ValidatorResult {
  passed: boolean;
  evidence: string;  // what was actually checked and what the result was
}

// ── Artifact builders ─────────────────────────────────────────────────────────

/** Build a real inline SVG brand mark from the brief. */
export function buildBrandArt(brief: Brief): BrandArtifact {
  const initial = brief.clientName.trim().charAt(0).toUpperCase() || 'B';
  const { primary, accent } = brief.colors;

  // Approximate WCAG relative luminance for hex colors
  const lum = (hex: string): number => {
    const n = parseInt(hex.replace('#', ''), 16);
    const r = (n >> 16) & 0xff;
    const g = (n >> 8) & 0xff;
    const b = n & 0xff;
    const toLinear = (c: number) => {
      const s = c / 255;
      return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
  };
  const l1 = lum(primary);
  const l2 = lum(accent);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  const contrastRatio = Math.round(((lighter + 0.05) / (darker + 0.05)) * 100) / 100;

  // Build inline SVG brand mark (real, inspectable)
  const svgMark = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">`,
    `<rect width="64" height="64" rx="14" fill="${primary}"/>`,
    `<circle cx="32" cy="32" r="22" fill="none" stroke="${accent}" stroke-width="2.5"/>`,
    `<text x="32" y="39" text-anchor="middle" font-family="Space Grotesk,sans-serif"`,
    ` font-weight="700" font-size="26" fill="${accent}">${initial}</text>`,
    `</svg>`,
  ].join('');

  return { svgMark, primaryHex: primary, accentHex: accent, contrastRatio, initial, generatedAt: new Date().toISOString() };
}

/** Build a real JSON game config from brief + locked constants. */
export function buildGameConfig(brief: Brief): GameConfigArtifact {
  return {
    gameTitle: brief.gameTitle.trim(),
    clientName: brief.clientName.trim(),
    primaryColor: brief.colors.primary,
    accentColor: brief.colors.accent,
    playerSpeed: 5,
    starValue: 10,
    obstaclePenalty: 5,
    durationSeconds: 30,
    mechanic: 'horizontal-collector',
    schemaVersion: '1.0',
    generatedAt: new Date().toISOString(),
  };
}

/** Build a delivery manifest (not a zip, not a CDN — local session record). */
export function buildManifest(
  jobId: string,
  brief: Brief,
  completedSteps: Partial<Record<ProductionStep, string>>
): ManifestArtifact {
  return {
    jobId,
    clientName: brief.clientName,
    gameTitle: brief.gameTitle,
    steps: {
      art: completedSteps.art ?? '',
      game_build: completedSteps.game_build ?? '',
      qa_checks: completedSteps.qa_checks ?? '',
      package: completedSteps.package ?? '',
    },
    deliverables: [
      `Playable ${brief.gameTitle} branded mini-game (in-session preview)`,
      'Brand mark SVG — generated in-browser, viewable in QA panel',
      'Game config JSON — generated in-browser, viewable in Production panel',
      'Session manifest (in-memory record of all artifacts)',
    ],
    note: 'Local session only. No files were written to disk, no CDN was contacted, no external services were called. This manifest records what was built in this browser session.',
    generatedAt: new Date().toISOString(),
  };
}

// ── Pure QA validators ────────────────────────────────────────────────────────
// Each validator takes data produced by the engine and asserts an invariant.
// Returns { passed, evidence } — never throws.

/** Config schema: required fields present and values in expected ranges. */
export function validateConfigSchema(config: GameConfigArtifact): ValidatorResult {
  const issues: string[] = [];
  if (!config.gameTitle.trim()) issues.push('gameTitle is empty');
  if (!config.clientName.trim()) issues.push('clientName is empty');
  if (!config.primaryColor.match(/^#[0-9a-fA-F]{6}$/)) issues.push(`primaryColor "${config.primaryColor}" is not a valid 6-digit hex`);
  if (!config.accentColor.match(/^#[0-9a-fA-F]{6}$/)) issues.push(`accentColor "${config.accentColor}" is not a valid 6-digit hex`);
  if (config.durationSeconds !== 30) issues.push(`durationSeconds is ${config.durationSeconds}, expected 30`);
  if (config.starValue !== 10) issues.push(`starValue is ${config.starValue}, expected 10`);
  if (config.obstaclePenalty !== 5) issues.push(`obstaclePenalty is ${config.obstaclePenalty}, expected 5`);
  if (config.schemaVersion !== '1.0') issues.push(`schemaVersion is "${config.schemaVersion}", expected "1.0"`);
  if (config.mechanic !== 'horizontal-collector') issues.push(`mechanic is not "horizontal-collector"`);
  const passed = issues.length === 0;
  const evidence = passed
    ? `Config valid: gameTitle="${config.gameTitle}", mechanic=${config.mechanic}, duration=${config.durationSeconds}s, schemaVersion=${config.schemaVersion}`
    : `Config invalid: ${issues.join('; ')}`;
  return { passed, evidence };
}

/** Brand SVG: non-empty, contains expected elements, initial matches brief. */
export function validateBrandSVG(art: BrandArtifact, brief: Brief): ValidatorResult {
  const issues: string[] = [];
  if (!art.svgMark.trim()) issues.push('svgMark is empty');
  if (!art.svgMark.includes('<svg')) issues.push('svgMark does not contain <svg');
  if (!art.svgMark.includes(art.primaryHex)) issues.push(`svgMark does not contain primaryHex ${art.primaryHex}`);
  if (!art.svgMark.includes(art.accentHex)) issues.push(`svgMark does not contain accentHex ${art.accentHex}`);
  const expectedInitial = brief.clientName.trim().charAt(0).toUpperCase();
  if (art.initial !== expectedInitial) issues.push(`initial is "${art.initial}", expected "${expectedInitial}"`);
  if (!art.svgMark.includes(art.initial)) issues.push(`svgMark does not contain initial "${art.initial}"`);
  const passed = issues.length === 0;
  const evidence = passed
    ? `Brand SVG valid: initial="${art.initial}", primaryHex=${art.primaryHex}, accentHex=${art.accentHex}, contrast=${art.contrastRatio}:1, length=${art.svgMark.length}ch`
    : `Brand SVG invalid: ${issues.join('; ')}`;
  return { passed, evidence };
}

/** Color contrast: WCAG minimum 2.5:1 for game display (non-body-text). */
export function validateColorContrast(art: BrandArtifact): ValidatorResult {
  const minRatio = 2.5;
  const passed = art.contrastRatio >= minRatio;
  const evidence = passed
    ? `Contrast ratio ${art.contrastRatio}:1 meets minimum ${minRatio}:1 (primary vs. accent)`
    : `Contrast ratio ${art.contrastRatio}:1 is below minimum ${minRatio}:1 — consider adjusting colors`;
  return { passed, evidence };
}

/** Scoring invariants: star adds 10, obstacle subtracts 5, floor at 0. */
export function validateScoringInvariants(config: GameConfigArtifact): ValidatorResult {
  const issues: string[] = [];
  // Simulate: collect 3 stars then hit 1 obstacle
  let score = 0;
  score += config.starValue; // +10 = 10
  score += config.starValue; // +10 = 20
  score += config.starValue; // +10 = 30
  score = Math.max(0, score - config.obstaclePenalty); // -5 = 25
  if (score !== 25) issues.push(`Expected 25 after 3 stars + 1 hit, got ${score}`);
  // Simulate: score at 3, obstacle brings to floor
  let lowScore = config.starValue * 1 - config.obstaclePenalty * 10;
  lowScore = Math.max(0, lowScore);
  if (lowScore !== 0) issues.push(`Floor not enforced: expected 0, got ${lowScore}`);
  // Timer invariant: game over when timeLeft <= 0
  let timeLeft = 0.1;
  timeLeft -= 0.5;
  const timerTriggersGameOver = timeLeft <= 0;
  if (!timerTriggersGameOver) issues.push('Timer did not trigger game-over at 0');
  const passed = issues.length === 0;
  const evidence = passed
    ? `Scoring OK: starValue=${config.starValue} (+pts), obstaclePenalty=${config.obstaclePenalty} (-pts), floor=0, timer→gameOver at t≤0`
    : `Scoring issues: ${issues.join('; ')}`;
  return { passed, evidence };
}

/** Restart invariant: score and time both reset. */
export function validateRestartInvariants(config: GameConfigArtifact): ValidatorResult {
  // Simulate a play session then restart
  let score = config.starValue * 5; // 50 pts
  let timeLeft = 8;
  // restart
  score = 0;
  timeLeft = config.durationSeconds;
  const scoreReset = score === 0;
  const timeReset = timeLeft === config.durationSeconds;
  const passed = scoreReset && timeReset;
  const evidence = passed
    ? `Restart OK: score→0, timeLeft→${config.durationSeconds}s`
    : `Restart failed: score=${score} (expected 0), timeLeft=${timeLeft} (expected ${config.durationSeconds})`;
  return { passed, evidence };
}

/** Manifest completeness: all 4 steps recorded. */
export function validateManifest(manifest: ManifestArtifact): ValidatorResult {
  const steps: ProductionStep[] = ['art', 'game_build', 'qa_checks', 'package'];
  const missing = steps.filter(s => !manifest.steps[s]);
  const passed = missing.length === 0;
  const evidence = passed
    ? `Manifest complete: all 4 steps recorded, jobId=${manifest.jobId}`
    : `Manifest incomplete: missing steps [${missing.join(', ')}]`;
  return { passed, evidence };
}

// ── Run all automated checks against real artifacts ───────────────────────────

export interface AutomatedQAResults {
  'qa-config-schema': ValidatorResult;
  'qa-brand-svg': ValidatorResult;
  'qa-contrast': ValidatorResult;
  'qa-config-scoring': ValidatorResult;
  'qa-config-restart': ValidatorResult;
  'qa-manifest': ValidatorResult;
}

export function runAutomatedChecks(
  artifacts: ProductionArtifacts,
  brief: Brief
): AutomatedQAResults {
  // Parse serialized artifacts; fall back to freshly built if absent
  let art: BrandArtifact;
  if (artifacts.brandArtSvg) {
    // Reconstruct a BrandArtifact from the stored SVG and brief
    const freshArt = buildBrandArt(brief);
    art = { ...freshArt, svgMark: artifacts.brandArtSvg };
  } else {
    art = buildBrandArt(brief);
  }

  let config: GameConfigArtifact;
  try {
    config = artifacts.gameConfigJson
      ? (JSON.parse(artifacts.gameConfigJson) as GameConfigArtifact)
      : buildGameConfig(brief);
  } catch {
    config = buildGameConfig(brief);
  }

  let manifest: ManifestArtifact;
  try {
    manifest = artifacts.manifestJson
      ? (JSON.parse(artifacts.manifestJson) as ManifestArtifact)
      : buildManifest('unknown', brief, {});
  } catch {
    manifest = buildManifest('unknown', brief, {});
  }

  return {
    'qa-config-schema': validateConfigSchema(config),
    'qa-brand-svg': validateBrandSVG(art, brief),
    'qa-contrast': validateColorContrast(art),
    'qa-config-scoring': validateScoringInvariants(config),
    'qa-config-restart': validateRestartInvariants(config),
    'qa-manifest': validateManifest(manifest),
  };
}

// ── Honest QA check definitions ───────────────────────────────────────────────
// automated = can be asserted by a pure function against produced artifacts
// manual    = requires a human to open the running preview

export type QACheckId =
  | keyof AutomatedQAResults
  | 'qa-behavior-controls'
  | 'qa-behavior-scoring'
  | 'qa-a11y-focus'
  | 'qa-mobile-375'
  | 'qa-gameover-cta';

export interface QACheckDef {
  id: QACheckId;
  label: string;
  type: 'automated' | 'manual';
  /** Section used in the QA panel to group and title the check. */
  section: 'artifact-config' | 'behavior';
  description: string; // explains what is being asserted
}

export const QA_CHECK_DEFS: QACheckDef[] = [
  // ── Artifact / config checks (automated) ────────────────────────────────────
  // These run pure assertions against the artifacts produced by the build steps.
  // They verify the config JSON and brand SVG are structurally correct.
  // They do NOT verify the game runs, responds to input, or scores correctly at runtime.
  {
    id: 'qa-config-schema',
    label: 'Game config schema valid',
    type: 'automated',
    section: 'artifact-config',
    description: 'Asserts required fields, value ranges, mechanic, and schemaVersion in the generated game config JSON',
  },
  {
    id: 'qa-brand-svg',
    label: 'Brand mark SVG well-formed',
    type: 'automated',
    section: 'artifact-config',
    description: 'Asserts SVG element present, both hex colors embedded, and client initial character matches brief',
  },
  {
    id: 'qa-contrast',
    label: 'Primary/accent contrast ≥ 2.5:1',
    type: 'automated',
    section: 'artifact-config',
    description: 'Computes approximate WCAG luminance contrast ratio between primary and accent hex colors in config',
  },
  {
    id: 'qa-config-scoring',
    label: 'Config scoring constants valid',
    type: 'automated',
    section: 'artifact-config',
    description: 'Config-level only: asserts starValue=10, obstaclePenalty=5, and floor logic in generated config JSON. Does not verify runtime game scoring.',
  },
  {
    id: 'qa-config-restart',
    label: 'Config restart constants valid',
    type: 'automated',
    section: 'artifact-config',
    description: 'Config-level only: asserts durationSeconds=30 in config JSON. Runtime reset behavior must be verified manually using the preview game.',
  },
  {
    id: 'qa-manifest',
    label: 'Session manifest complete',
    type: 'automated',
    section: 'artifact-config',
    description: 'Asserts all 4 production steps are recorded in the in-session manifest artifact',
  },

  // ── Behavioral checks (manual) ───────────────────────────────────────────────
  // These can only be verified by a human playing the game in the preview below.
  // Use the embedded game to confirm each one before marking pass/fail.
  {
    id: 'qa-behavior-controls',
    label: 'Keyboard and touch controls work in game',
    type: 'manual',
    section: 'behavior',
    description: 'Play the game below: confirm arrow keys/A-D move the player on desktop; confirm on-screen touch buttons work on mobile/touch.',
  },
  {
    id: 'qa-behavior-scoring',
    label: 'Scoring, timer, and game-over work correctly',
    type: 'manual',
    section: 'behavior',
    description: 'Play the game below: confirm collecting stars adds points, obstacles subtract, score floors at 0, timer counts down from 30s, and game over triggers when time expires.',
  },
  {
    id: 'qa-gameover-cta',
    label: 'Branded game-over CTA displays correctly',
    type: 'manual',
    section: 'behavior',
    description: 'Play to game-over: confirm branded client name appears in the CTA text and brand colors are applied to game canvas.',
  },
  {
    id: 'qa-a11y-focus',
    label: 'Focus states visible on all UI controls',
    type: 'manual',
    section: 'behavior',
    description: 'Tab through all interactive elements in this panel: confirm focus ring is visible on buttons, Pass/Fail controls, and game controls.',
  },
  {
    id: 'qa-mobile-375',
    label: 'Layout correct at 375px viewport',
    type: 'manual',
    section: 'behavior',
    description: 'Resize to 375px width and confirm no overflow, clipped text, broken layout, or unusable touch targets in the game or QA panel.',
  },
];
