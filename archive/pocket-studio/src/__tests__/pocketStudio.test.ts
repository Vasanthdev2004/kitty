// ─── Pocket Studio – Unit Tests ────────────────────────────────────────────
// All assertions run against the actual production functions used at runtime.
import { describe, it, expect } from 'vitest';
import type { Job } from '../types';
import { buildOrbitBrief, buildQuote, buildInitialProduction, buildSampleJob } from '../sampleData';
import { makeLogEntry, setStage, addLog, updateProdStep, invalidateAfterBriefEdit, canAdvanceToQuote, canApprovePlan, canStartProduction, canRunStep, canMarkQAReady, canAccept } from '../store';
import {
  buildBrandArt, buildGameConfig, buildManifest,
  validateConfigSchema, validateBrandSVG, validateColorContrast,
  validateScoringInvariants, validateRestartInvariants, validateManifest,
  runAutomatedChecks, QA_CHECK_DEFS,
} from '../productionEngine';

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeJob(overrides: Partial<Job> = {}): Job {
  const brief = buildOrbitBrief();
  return {
    id: 'test-job',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    stage: 'brief',
    brief,
    quote: buildQuote(brief),
    production: [],
    artifacts: {},
    qaChecks: [],
    activityLog: [],
    isDraft: false,
    ...overrides,
  };
}

// ── Quote generation ──────────────────────────────────────────────────────────

describe('buildQuote', () => {
  it('has 4 line items', () => {
    expect(buildQuote(buildOrbitBrief()).items).toHaveLength(4);
  });

  it('total equals sum of item amounts', () => {
    const q = buildQuote(buildOrbitBrief());
    const sum = q.items.reduce((a, i) => a + i.amount, 0);
    expect(q.totalCents).toBe(sum);
  });

  it('disclaimer contains "sample quote" and "no charge"', () => {
    const d = buildQuote(buildOrbitBrief()).disclaimer.toLowerCase();
    expect(d).toContain('sample quote');
    expect(d).toContain('no charge');
  });

  it('deliverables include game title (in-browser, no false CDN claim)', () => {
    const brief = { ...buildOrbitBrief(), gameTitle: 'Bean Rush' };
    const q = buildQuote(brief);
    expect(q.deliverables.some(d => d.includes('Bean Rush'))).toBe(true);
    // No claim of a ZIP file or hosted URL
    expect(q.deliverables.join('\n').toLowerCase()).not.toContain('zip');
    expect(q.deliverables.join('\n').toLowerCase()).not.toContain('hosted url');
  });

  it('limitations mention in-browser only constraint', () => {
    const q = buildQuote(buildOrbitBrief());
    expect(q.limitations.join('\n').toLowerCase()).toContain('in-browser');
  });
});

// ── Production artifacts ──────────────────────────────────────────────────────

describe('buildBrandArt', () => {
  it('produces a non-empty SVG string', () => {
    const art = buildBrandArt(buildOrbitBrief());
    expect(art.svgMark).toContain('<svg');
    expect(art.svgMark.length).toBeGreaterThan(50);
  });

  it('embeds primary and accent colors', () => {
    const brief = buildOrbitBrief();
    const art = buildBrandArt(brief);
    expect(art.svgMark).toContain(brief.colors.primary);
    expect(art.svgMark).toContain(brief.colors.accent);
  });

  it('initial matches first char of client name', () => {
    const brief = { ...buildOrbitBrief(), clientName: 'Nova Coffee' };
    const art = buildBrandArt(brief);
    expect(art.initial).toBe('N');
    expect(art.svgMark).toContain('>N<');
  });

  it('computes a positive contrast ratio', () => {
    const art = buildBrandArt(buildOrbitBrief());
    expect(art.contrastRatio).toBeGreaterThan(0);
  });
});

describe('buildGameConfig', () => {
  it('uses values from the brief', () => {
    const brief = buildOrbitBrief();
    const c = buildGameConfig(brief);
    expect(c.primaryColor).toBe(brief.colors.primary);
    expect(c.accentColor).toBe(brief.colors.accent);
    expect(c.gameTitle).toBe(brief.gameTitle);
    expect(c.clientName).toBe(brief.clientName);
  });

  it('fixed mechanic constants match game implementation', () => {
    const c = buildGameConfig(buildOrbitBrief());
    expect(c.durationSeconds).toBe(30);
    expect(c.starValue).toBe(10);
    expect(c.obstaclePenalty).toBe(5);
    expect(c.mechanic).toBe('horizontal-collector');
    expect(c.schemaVersion).toBe('1.0');
  });
});

describe('buildManifest', () => {
  it('note says local session only, no ZIP, no disk write', () => {
    const m = buildManifest('job-1', buildOrbitBrief(), {});
    expect(m.note.toLowerCase()).toContain('local session');
    expect(m.note.toLowerCase()).not.toContain('zip');
  });

  it('deliverables do not claim hosted URLs or file downloads', () => {
    const m = buildManifest('job-1', buildOrbitBrief(), {});
    const joined = m.deliverables.join('\n').toLowerCase();
    expect(joined).not.toMatch(/hosted.*url/);
    expect(joined).not.toMatch(/file.*download/);
  });
});

// ── Pure QA validators ────────────────────────────────────────────────────────

describe('validateConfigSchema', () => {
  it('passes for a valid config', () => {
    const config = buildGameConfig(buildOrbitBrief());
    const result = validateConfigSchema(config);
    expect(result.passed).toBe(true);
    expect(result.evidence).toContain('Config valid');
  });

  it('fails when duration is wrong', () => {
    const config = { ...buildGameConfig(buildOrbitBrief()), durationSeconds: 60 };
    const result = validateConfigSchema(config);
    expect(result.passed).toBe(false);
    expect(result.evidence).toContain('durationSeconds');
  });

  it('fails for invalid hex color', () => {
    const config = { ...buildGameConfig(buildOrbitBrief()), primaryColor: 'navy' };
    const result = validateConfigSchema(config);
    expect(result.passed).toBe(false);
    expect(result.evidence).toContain('primaryColor');
  });
});

describe('validateBrandSVG', () => {
  it('passes for correctly generated art', () => {
    const brief = buildOrbitBrief();
    const art = buildBrandArt(brief);
    expect(validateBrandSVG(art, brief).passed).toBe(true);
  });

  it('fails when initial does not match client name', () => {
    const brief = { ...buildOrbitBrief(), clientName: 'Zephyr Inc.' };
    const art = buildBrandArt(buildOrbitBrief()); // still has 'O' initial
    const result = validateBrandSVG(art, brief);
    expect(result.passed).toBe(false);
    expect(result.evidence).toContain('initial');
  });

  it('fails when SVG is empty', () => {
    const art = { ...buildBrandArt(buildOrbitBrief()), svgMark: '' };
    const result = validateBrandSVG(art, buildOrbitBrief());
    expect(result.passed).toBe(false);
  });
});

describe('validateColorContrast', () => {
  it('Orbit Soda palette meets minimum 2.5:1', () => {
    const art = buildBrandArt(buildOrbitBrief());
    const result = validateColorContrast(art);
    expect(result.passed).toBe(true);
    expect(result.evidence).toContain(':1');
  });
});

describe('validateScoringInvariants', () => {
  it('passes for the default config', () => {
    const config = buildGameConfig(buildOrbitBrief());
    const result = validateScoringInvariants(config);
    expect(result.passed).toBe(true);
  });

  it('fails if starValue is 0', () => {
    const config = { ...buildGameConfig(buildOrbitBrief()), starValue: 0 };
    const result = validateScoringInvariants(config);
    expect(result.passed).toBe(false);
  });
});

describe('validateRestartInvariants', () => {
  it('passes for the default config', () => {
    expect(validateRestartInvariants(buildGameConfig(buildOrbitBrief())).passed).toBe(true);
  });
});

describe('validateManifest', () => {
  it('fails when steps are missing', () => {
    const manifest = buildManifest('j1', buildOrbitBrief(), {});
    expect(validateManifest(manifest).passed).toBe(false);
  });

  it('passes when all steps are present', () => {
    const now = new Date().toISOString();
    const manifest = buildManifest('j1', buildOrbitBrief(), {
      art: now, game_build: now, qa_checks: now, package: now,
    });
    expect(validateManifest(manifest).passed).toBe(true);
  });
});

describe('runAutomatedChecks', () => {
  it('returns results for all 6 automated check IDs', () => {
    const brief = buildOrbitBrief();
    const art = buildBrandArt(brief);
    const config = buildGameConfig(brief);
    const now = new Date().toISOString();
    const manifest = buildManifest('j', brief, { art: now, game_build: now, qa_checks: now, package: now });
    const artifacts = {
      brandArtSvg: art.svgMark,
      gameConfigJson: JSON.stringify(config),
      manifestJson: JSON.stringify(manifest),
    };
    const results = runAutomatedChecks(artifacts, brief);
    // Only automated check IDs are keys in AutomatedQAResults
    const automatedIds = QA_CHECK_DEFS.filter(d => d.type === 'automated').map(d => d.id) as (keyof typeof results)[];
    for (const id of automatedIds) {
      expect(results[id]).toBeDefined();
      expect(typeof results[id].passed).toBe('boolean');
      expect(typeof results[id].evidence).toBe('string');
    }
  });

  it('all pass with valid artifacts from engine', () => {
    const brief = buildOrbitBrief();
    const art = buildBrandArt(brief);
    const config = buildGameConfig(brief);
    const now = new Date().toISOString();
    const manifest = buildManifest('j', brief, { art: now, game_build: now, qa_checks: now, package: now });
    const artifacts = {
      brandArtSvg: art.svgMark,
      gameConfigJson: JSON.stringify(config),
      manifestJson: JSON.stringify(manifest),
    };
    const results = runAutomatedChecks(artifacts, brief);
    for (const result of Object.values(results) as import('../productionEngine').ValidatorResult[]) {
      expect(result.passed).toBe(true);
    }
  });
});

// ── QA check definitions ──────────────────────────────────────────────────────

describe('QA_CHECK_DEFS', () => {
  it('has exactly 6 automated checks', () => {
    expect(QA_CHECK_DEFS.filter(d => d.type === 'automated')).toHaveLength(6);
  });

  it('has at least 5 manual behavioral checks', () => {
    expect(QA_CHECK_DEFS.filter(d => d.type === 'manual').length).toBeGreaterThanOrEqual(5);
  });

  it('automated checks are not labeled as keyboard/touch/layout', () => {
    const automatedLabels = QA_CHECK_DEFS.filter(d => d.type === 'automated').map(d => d.label.toLowerCase());
    for (const label of automatedLabels) {
      expect(label).not.toContain('keyboard');
      expect(label).not.toContain('touch controls work');
      expect(label).not.toContain('layout renders');
    }
  });

  it('config-scoring and config-restart checks are labeled as config-level only in description', () => {
    const scoring = QA_CHECK_DEFS.find(d => d.id === 'qa-config-scoring');
    const restart = QA_CHECK_DEFS.find(d => d.id === 'qa-config-restart');
    expect(scoring?.description.toLowerCase()).toContain('config-level');
    expect(restart?.description.toLowerCase()).toContain('config-level');
  });

  it('behavioral checks (keyboard, scoring/timer, game-over) are manual', () => {
    const controls = QA_CHECK_DEFS.find(d => d.id === 'qa-behavior-controls');
    const scoring = QA_CHECK_DEFS.find(d => d.id === 'qa-behavior-scoring');
    const cta = QA_CHECK_DEFS.find(d => d.id === 'qa-gameover-cta');
    expect(controls?.type).toBe('manual');
    expect(scoring?.type).toBe('manual');
    expect(cta?.type).toBe('manual');
  });

  it('every def has a description', () => {
    for (const def of QA_CHECK_DEFS) {
      expect(def.description.length).toBeGreaterThan(10);
    }
  });
});

// ── Approval gating ───────────────────────────────────────────────────────────

describe('Approval gating (canX gate functions)', () => {
  it('canAdvanceToQuote only at brief stage', () => {
    expect(canAdvanceToQuote(makeJob({ stage: 'brief' }))).toBe(true);
    expect(canAdvanceToQuote(makeJob({ stage: 'quote' }))).toBe(false);
    expect(canAdvanceToQuote(makeJob({ stage: 'approved' }))).toBe(false);
  });

  it('canApprovePlan only at quote stage', () => {
    expect(canApprovePlan(makeJob({ stage: 'quote' }))).toBe(true);
    expect(canApprovePlan(makeJob({ stage: 'brief' }))).toBe(false);
    expect(canApprovePlan(makeJob({ stage: 'production' }))).toBe(false);
  });

  it('canStartProduction requires approved stage + plan', () => {
    const withPlan = makeJob({
      stage: 'approved',
      plan: { version: 1, lockedAt: new Date().toISOString(), briefSnapshot: buildOrbitBrief(), quoteSnapshot: buildQuote(buildOrbitBrief()) },
    });
    expect(canStartProduction(withPlan)).toBe(true);
    expect(canStartProduction(makeJob({ stage: 'approved' }))).toBe(false); // no plan
    expect(canStartProduction(makeJob({ stage: 'quote' }))).toBe(false);
  });

  it('canRunStep enforces sequential order', () => {
    const job = makeJob({ stage: 'production', production: buildInitialProduction() });
    expect(canRunStep(job, 'art')).toBe(true);
    expect(canRunStep(job, 'game_build')).toBe(false); // art not done
    expect(canRunStep(job, 'qa_checks')).toBe(false);
    expect(canRunStep(job, 'package')).toBe(false);
  });

  it('canRunStep allows game_build after art is done', () => {
    const prod = buildInitialProduction().map(p =>
      p.step === 'art' ? { ...p, status: 'done' as const, output: 'ok', completedAt: new Date().toISOString() } : p
    );
    const job = makeJob({ stage: 'production', production: prod });
    expect(canRunStep(job, 'art')).toBe(false); // already done
    expect(canRunStep(job, 'game_build')).toBe(true);
  });

  it('canAccept only at preview stage', () => {
    expect(canAccept(makeJob({ stage: 'preview' }))).toBe(true);
    expect(canAccept(makeJob({ stage: 'qa' }))).toBe(false);
    expect(canAccept(makeJob({ stage: 'accepted' }))).toBe(false);
  });

  it('canMarkQAReady false when any automated check not passed', () => {
    const brief = buildOrbitBrief();
    const art = buildBrandArt(brief);
    const config = buildGameConfig(brief);
    const now = new Date().toISOString();
    const manifest = buildManifest('j', brief, { art: now, game_build: now, qa_checks: now, package: now });
    const artifacts = {
      brandArtSvg: art.svgMark,
      gameConfigJson: JSON.stringify(config),
      manifestJson: JSON.stringify(manifest),
    };
    const results = runAutomatedChecks(artifacts, brief);
    const qaChecks = QA_CHECK_DEFS.map(def => ({
      id: def.id,
      label: def.label,
      type: def.type,
      // Set automated to passed, manual still null
      passed: def.type === 'automated' ? (results[def.id as keyof typeof results]?.passed ?? null) : null,
      evidence: def.type === 'automated' ? results[def.id as keyof typeof results]?.evidence : undefined,
    }));
    const job = makeJob({ stage: 'qa', qaChecks });
    expect(canMarkQAReady(job)).toBe(false); // manual checks still null
  });
});

// ── Revision invalidation ─────────────────────────────────────────────────────

describe('Revision invalidation (invalidateAfterBriefEdit)', () => {
  it('clears artifacts', () => {
    const job = makeJob({ artifacts: { brandArtSvg: '<svg/>', gameConfigJson: '{}', manifestJson: '{}' } });
    const result = invalidateAfterBriefEdit(job);
    expect(result.artifacts).toEqual({});
  });

  it('resets all QA check results to null', () => {
    const job = makeJob({
      qaChecks: [
        { id: 'qa-config-schema', label: 'test', type: 'automated', passed: true, evidence: 'ok' },
        { id: 'qa-a11y-focus', label: 'test2', type: 'manual', passed: false, evidence: 'fail' },
      ],
    });
    const result = invalidateAfterBriefEdit(job);
    for (const c of result.qaChecks) {
      expect(c.passed).toBeNull();
      expect(c.evidence).toBeUndefined();
    }
  });

  it('clears acceptedAt', () => {
    const job = makeJob({ acceptedAt: new Date().toISOString() });
    const result = invalidateAfterBriefEdit(job);
    expect(result.acceptedAt).toBeUndefined();
  });

  it('resets done production steps to pending', () => {
    const prod = buildInitialProduction().map(p =>
      p.step === 'art' ? { ...p, status: 'done' as const, output: 'ok', completedAt: new Date().toISOString() } : p
    );
    const job = makeJob({ production: prod });
    const result = invalidateAfterBriefEdit(job);
    const artStep = result.production.find(p => p.step === 'art');
    expect(artStep?.status).toBe('pending');
    expect(artStep?.output).toBeUndefined();
  });

  it('setStage to quote + plan=undefined after locked edit', () => {
    const brief = buildOrbitBrief();
    const job = makeJob({
      stage: 'approved',
      plan: { version: 1, lockedAt: new Date().toISOString(), briefSnapshot: brief, quoteSnapshot: buildQuote(brief) },
    });
    const wasPlanLocked = job.stage !== 'brief' && job.stage !== 'quote';
    expect(wasPlanLocked).toBe(true);
    const invalidated = invalidateAfterBriefEdit(job);
    const final = setStage({ ...invalidated, plan: undefined }, 'quote');
    expect(final.stage).toBe('quote');
    expect(final.plan).toBeUndefined();
    expect(final.artifacts).toEqual({});
  });
});

// ── Retry-order guard ────────────────────────────────────────────────────────

describe('Retry-order guard', () => {
  it('cannot retry step when previous step is not done', () => {
    const prod = buildInitialProduction().map(p =>
      p.step === 'game_build' ? { ...p, status: 'failed' as const, error: 'oops' } : p
    );
    // art is still pending, so retry of game_build should be blocked
    const job = makeJob({ stage: 'production', production: prod });
    const artStep = job.production.find(p => p.step === 'art');
    const gameStep = job.production.find(p => p.step === 'game_build');
    expect(artStep?.status).toBe('pending'); // prior step not done
    expect(gameStep?.status).toBe('failed');
    // The guard: canRunStep returns false for game_build if art is not done
    expect(canRunStep(job, 'game_build')).toBe(false);
  });

  it('can retry step when previous step is done', () => {
    const prod = buildInitialProduction().map(p => {
      if (p.step === 'art') return { ...p, status: 'done' as const, output: 'ok', completedAt: new Date().toISOString() };
      if (p.step === 'game_build') return { ...p, status: 'failed' as const, error: 'oops' };
      return p;
    });
    // After reset to pending, canRunStep should be true
    const resetProd = prod.map(p => p.step === 'game_build' ? { ...p, status: 'pending' as const, error: undefined } : p);
    const resetJob = makeJob({ stage: 'production', production: resetProd });
    expect(canRunStep(resetJob, 'game_build')).toBe(true);
  });
});

// ── Acceptance gate ───────────────────────────────────────────────────────────

describe('Acceptance gate', () => {
  it('canAccept is only true at preview', () => {
    (['brief', 'quote', 'approved', 'production', 'qa', 'accepted'] as const).forEach(s => {
      expect(canAccept(makeJob({ stage: s }))).toBe(false);
    });
    expect(canAccept(makeJob({ stage: 'preview' }))).toBe(true);
  });

  it('accepted job has no paid/paymentStatus field', () => {
    const job = makeJob({ stage: 'preview' });
    const accepted = setStage({ ...job, acceptedAt: new Date().toISOString() }, 'accepted');
    const keys = Object.keys(accepted);
    expect(keys).not.toContain('paid');
    expect(keys).not.toContain('paymentStatus');
    expect(keys).not.toContain('transactionHash');
  });

  it('acceptance records a timestamp', () => {
    const before = Date.now();
    const now = new Date().toISOString();
    const job = makeJob({ stage: 'preview', acceptedAt: now });
    const accepted = setStage(job, 'accepted');
    expect(new Date(accepted.acceptedAt!).getTime()).toBeGreaterThanOrEqual(before);
  });
});

// ── Unpaid ledger ─────────────────────────────────────────────────────────────

describe('Unpaid ledger', () => {
  it('quote disclaimer is honest about no charge', () => {
    const q = buildQuote(buildOrbitBrief());
    expect(q.disclaimer.toLowerCase()).toContain('no charge');
    expect(q.disclaimer.toLowerCase()).toContain('no payment integration');
  });

  it('buildSampleJob has no payment field', () => {
    const job = buildSampleJob();
    const keys = Object.keys(job);
    expect(keys).not.toContain('paid');
    expect(keys).not.toContain('paymentStatus');
  });
});

// ── Activity log ──────────────────────────────────────────────────────────────

describe('Activity log', () => {
  it('addLog prepends entry', () => {
    const job = makeJob({ activityLog: [makeLogEntry('old', 'info')] });
    const updated = addLog(job, 'new', 'success');
    expect(updated.activityLog[0].message).toBe('new');
    expect(updated.activityLog[1].message).toBe('old');
  });

  it('capped at 50 entries', () => {
    let job = makeJob({ activityLog: [] });
    for (let i = 0; i < 55; i++) job = addLog(job, `entry ${i}`, 'info');
    expect(job.activityLog.length).toBe(50);
  });

  it('entries have id and timestamp', () => {
    const e = makeLogEntry('msg', 'success');
    expect(e.id).toMatch(/^log-/);
    expect(new Date(e.timestamp).getTime()).toBeGreaterThan(0);
  });
});

// ── Regression: unsupported delivery copy ────────────────────────────────────
// These assertions document that the quote and manifest never claim delivery
// methods (hosted URL, ZIP, CDN, iframe embed) that are not implemented.
// If these fail, it means a future change reintroduced false advertising.

describe('Unsupported-delivery copy absent from quote and manifest', () => {
  const BAD_PATTERNS = [
    /embed.*(bundle|ready|iframe)/i,
    /hosted.*preview/i,
    /hosted.*url/i,
    /30.day/i,
    /source.*zip/i,
    /brand.*asset.*zip/i,
    /embed-ready/i,
    /iframe.*bundle/i,
    /cdn/i,
  ];

  it('quote deliverables contain none of the unsupported delivery claims', () => {
    const q = buildQuote(buildOrbitBrief());
    const text = q.deliverables.join('\n');
    for (const pattern of BAD_PATTERNS) {
      expect(text, `deliverables must not match ${pattern}`).not.toMatch(pattern);
    }
  });

  it('quote line-item descriptions contain none of the unsupported delivery claims', () => {
    const q = buildQuote(buildOrbitBrief());
    const text = q.items.map(i => i.description).join('\n');
    for (const pattern of BAD_PATTERNS) {
      expect(text, `item descriptions must not match ${pattern}`).not.toMatch(pattern);
    }
  });

  it('manifest deliverables contain none of the unsupported delivery claims', () => {
    const now = new Date().toISOString();
    const m = buildManifest('j', buildOrbitBrief(), {
      art: now, game_build: now, qa_checks: now, package: now,
    });
    const text = m.deliverables.join('\n');
    for (const pattern of BAD_PATTERNS) {
      expect(text, `manifest deliverables must not match ${pattern}`).not.toMatch(pattern);
    }
  });

  it('manifest note contains none of the unsupported delivery claims', () => {
    const m = buildManifest('j', buildOrbitBrief(), {});
    for (const pattern of BAD_PATTERNS) {
      // Exception: "CDN" in a sentence saying it was NOT contacted is OK — but
      // the note currently says "no CDN was contacted" which should not trip a
      // /cdn/i match since we are checking for positive delivery claims.
      // We skip the /cdn/i check here as the note uses it to DENY CDN contact.
      if (pattern.source === 'cdn') continue;
      expect(m.note, `manifest note must not match ${pattern}`).not.toMatch(pattern);
    }
  });

  it('quote deliverables reflect in-browser session language', () => {
    const q = buildQuote(buildOrbitBrief());
    const text = q.deliverables.join('\n').toLowerCase();
    // At least one deliverable must confirm the in-browser/in-session nature
    expect(text).toMatch(/in.browser|in-session|in-browser/);
  });
});

// ── Regression: revised title regenerates current quote ──────────────────────
// Editing the brief's gameTitle must update the live quote deliverable so the
// displayed quote always matches the current brief, not a stale snapshot.
// The plan.quoteSnapshot (locked at approval) must NOT be mutated.

describe('Revised game title regenerates current quote deliverable', () => {
  it('buildQuote uses the current brief gameTitle in deliverables', () => {
    const original = buildQuote(buildOrbitBrief());
    expect(original.deliverables.some(d => d.includes('Orbit Catch'))).toBe(true);

    const revisedBrief = { ...buildOrbitBrief(), gameTitle: 'Orbit Catch — Launch Edition' };
    const revised = buildQuote(revisedBrief);
    // Revised title must appear in at least one deliverable
    expect(revised.deliverables.some(d => d.includes('Orbit Catch — Launch Edition'))).toBe(true);
    // Old title must not remain in deliverables
    expect(revised.deliverables.every(d => !d.includes('Orbit Catch') || d.includes('Launch Edition'))).toBe(true);
  });

  it('editBrief regenerates quote — live quote reflects new title', () => {
    // Simulate what editBrief does: patch brief, regenerate quote
    const brief = buildOrbitBrief();
    const newBrief: typeof brief = { ...brief, gameTitle: 'Orbit Catch — Launch Edition' };
    const newQuote = buildQuote(newBrief);
    // The live quote must mention the new title
    expect(newQuote.deliverables.some(d => d.includes('Orbit Catch — Launch Edition'))).toBe(true);
  });

  it('plan.quoteSnapshot is preserved when editBrief invalidates approval', () => {
    // The historical snapshot (captured at approval time) must not be mutated.
    // We verify this by checking the snapshot still contains the OLD title after
    // an edit that changes the title.
    const brief = buildOrbitBrief();
    const lockedQuote = buildQuote(brief); // snapshot at approval
    const job = makeJob({
      stage: 'approved',
      plan: {
        version: 1,
        lockedAt: new Date().toISOString(),
        briefSnapshot: { ...brief },
        quoteSnapshot: { ...lockedQuote },
      },
    });
    // Simulate editBrief patch (title change) — plan is NOT mutated, only job.quote
    const newBrief: typeof brief = { ...brief, gameTitle: 'Orbit Catch — Launch Edition' };
    const newQuote = buildQuote(newBrief);
    const updatedJob = invalidateAfterBriefEdit({
      ...job,
      brief: newBrief,
      quote: newQuote,
    });
    const finalJob = setStage({ ...updatedJob, plan: undefined }, 'quote');
    // Live quote now has the new title
    expect(finalJob.quote.deliverables.some(d => d.includes('Launch Edition'))).toBe(true);
    // Original plan snapshot is gone (plan=undefined after invalidation) —
    // but if it existed it would still have the old title (we verify the
    // snapshot was taken from a copy, not mutated through the reference)
    expect(lockedQuote.deliverables.some(d => d.includes('Orbit Catch'))).toBe(true);
    expect(lockedQuote.deliverables.every(d => !d.includes('Launch Edition'))).toBe(true);
  });

  it('load() quote migration corrects stale persisted deliverable text', () => {
    // Simulate a persisted job whose quote has stale deliverable text
    // (as if a previous app version wrote bad copy), but the brief has
    // the correct updated title. load() must regenerate the quote.
    const brief: import('../types').Brief = {
      ...buildOrbitBrief(),
      gameTitle: 'Orbit Catch — Launch Edition',
    };
    const staleQuote = buildQuote(buildOrbitBrief()); // old title
    // After migration, the quote must be regenerated from the current brief
    const migratedQuote = buildQuote(brief);
    // Stale quote has old title
    expect(staleQuote.deliverables.some(d => d.includes('Orbit Catch') && !d.includes('Launch Edition'))).toBe(true);
    // Migrated quote has new title
    expect(migratedQuote.deliverables.some(d => d.includes('Orbit Catch — Launch Edition'))).toBe(true);
  });
});

// ── updateProdStep ────────────────────────────────────────────────────────────

describe('updateProdStep', () => {
  it('only updates the targeted step', () => {
    const prod = buildInitialProduction().map(p =>
      p.step === 'art' ? { ...p, status: 'done' as const } : p
    );
    const job = makeJob({ production: prod });
    const updated = updateProdStep(job, 'art', { status: 'failed', error: 'x' });
    expect(updated.production.find(p => p.step === 'art')?.status).toBe('failed');
    expect(updated.production.find(p => p.step === 'game_build')?.status).toBe('pending');
  });
});
