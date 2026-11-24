'use strict';

const { refinementView } = require('./hypothesisRefinement');
const { negativeLearning: negativeLearningView } = require('./dojoNegativeReview');
const { learningView } = require('./dojoLearning');
const {laneView,capabilityComparison,metaUsage}=require('./dojoLearningEfficiency');

// The improvement loop of a スキル錬成道場, as numbers. A trial is one sample shown to the user, registered
// with the hypotheses it tests and the predicted chance of passing before the user rates it. The pass rate
// per released version measures user-reviewed dojos; measurement-confirmed dojos use external evidence.

const VERDICTS = ['pass', 'partial', 'fail', 'withdrawn'];
const FAIL_STAGES = ['source', 'selection', 'transform', 'voice', 'gate', 'unknown'];
// AI-provisional thresholds. They shape pacing, not what counts as a pass.
const LIMITS = Object.freeze({
  maxAwaiting: 6,          // unrated samples allowed before new ones are refused
  minRatedPerVersion: 3,   // ratings a released version needs before the next version
  failStreak: 3,           // consecutive non-passes that force a finished run before the next sample
  hypothesisMinTrials: 3,  // ratings before a hypothesis is called dead or winning
});

const round = (value) => Math.round(value * 1000) / 1000;
const rateOf = (pass, rated) => (rated ? round(pass / rated) : null);
const versionKey = (entry) => (entry.version === null || entry.version === undefined ? (entry.methodVersion || 'unknown') : 'v' + entry.version);

// Trials plus the evaluations of submarine haul (feedbackLog), one entry per rated thing.
function ratedEntries(trials, feedbackLog) {
  const seen = new Set();
  const entries = [];
  trials.filter((t) => t.status === 'rated' && t.verdict !== 'withdrawn').forEach((t) => {
    if (t.ref) seen.add(t.ref);
    entries.push({
      id: t.id, kind: 'trial', label: t.label, verdict: t.verdict, at: t.ratedAt || t.createdAt, version: t.version ?? null,
      methodVersion: t.methodVersion || null, predictedPass: typeof t.predictedPass === 'number' ? t.predictedPass : null,
      hypothesisIds: t.hypothesisIds || [], userWords: t.userWords || '', failStage: t.failStage || '',
    });
  });
  (feedbackLog || []).forEach((f) => {
    if (seen.has(f.ref) || (f.decision !== 'confirmed' && f.decision !== 'declined')) return;
    entries.push({
      id: f.haulId || f.ref, kind: 'haul', label: f.label, verdict: f.decision === 'confirmed' ? 'pass' : 'fail', at: f.at,
      version: f.version ?? null, methodVersion: null, predictedPass: null, hypothesisIds: [], userWords: f.comment || f.actionLabel || '', failStage: '',
    });
  });
  return entries.sort((a, b) => String(a.at || '').localeCompare(String(b.at || '')));
}

function tally(entries) {
  const pass = entries.filter((e) => e.verdict === 'pass').length;
  const partial = entries.filter((e) => e.verdict === 'partial').length;
  const fail = entries.filter((e) => e.verdict === 'fail').length;
  const rated = pass + partial + fail;
  return { rated, pass, partial, fail, passRate: rateOf(pass, rated) };
}

function failStreakOf(entries) {
  let streak = 0;
  for (let i = entries.length - 1; i >= 0 && entries[i].verdict !== 'pass'; i -= 1) streak += 1;
  return streak;
}

// Everything the 道場 shows about its loop. `base` supplies the released version and the last finished run.
function wilson95(passed,n) {
  if(!n)return null;
  const z=1.96,p=passed/n,den=1+(z*z)/n;
  const c=(p+(z*z)/(2*n))/den;
  const margin=z*Math.sqrt(p*(1-p)/n+(z*z)/(4*n*n))/den;
  return {low:round(Math.max(0,c-margin)),high:round(Math.min(1,c+margin))};
}
// Monitoring provides a review signal, never an automatic Skill rollback.
function releaseRegressionHealth(current,previous,measurementMode=false) {
  const minimum=8;
  const currentCI=wilson95(current.pass||0,current.rated||0);
  const previousCI=previous?wilson95(previous.pass||0,previous.rated||0):null;
  const status=measurementMode?'measurement_mode_requires_operator_data'
    :!previous?'no_comparable_previous_version'
    :current.rated<minimum||previous.rated<minimum?'too_few_human_ratings'
    :currentCI.high<previousCI.low?'regression_alert'
    :currentCI.low>previousCI.high?'improvement_signal':'inconclusive_difference';
  return {status,minimumRatedPerVersion:minimum,currentCI,previousCI,
    automaticRollback:false,
    nextAction:status==='regression_alert'?'Review changed Skill rules and prepare a separately authorized revert.'
      :status==='too_few_human_ratings'?'Gather more genuine user-rated samples before concluding the new Skill is worse.'
      :'Continue comparing future human-rated results under the current release gates.'};
}

function loopView({ trials, feedbackLog, base, hypotheses }) {
  const entries = ratedEntries(trials || [], feedbackLog);
  const { trialArtifactStatus } = require('./dojoArtifactReadiness');
  const awaiting = (trials || []).filter((t) => t.status === 'awaiting');
  const releasedNumber = base?.method?.bodyRef?.versionNumber ?? null;
  const currentKey = releasedNumber !== null ? 'v' + releasedNumber : (base?.method?.version || 'unknown');

  const groups = new Map();
  entries.forEach((e) => { const key = versionKey(e); groups.set(key, [...(groups.get(key) || []), e]); });
  const byVersion = [...groups.entries()].map(([key, list]) => ({
    version: key, released: key === currentKey, ...tally(list), lastRatedAt: list[list.length - 1].at,
  })).sort((a, b) => String(b.lastRatedAt || '').localeCompare(String(a.lastRatedAt || '')));
  const current = byVersion.find((g) => g.released) || { version: currentKey, released: true, ...tally([]) };
  // The version to beat: the most recently rated earlier version with enough ratings to compare.
  const previous = byVersion.find((g) => !g.released && g.rated >= LIMITS.minRatedPerVersion) || null;
  const mixedReleaseHealth=releaseRegressionHealth(current,previous,base?.outcome?.confirmedBy==='measurement');
  const lanes=laneView(trials||[],base);
  const capabilityHealth=capabilityComparison(trials||[],base,releaseRegressionHealth);
  const releaseHealth={...mixedReleaseHealth,scope:'mixed_historical_ratings_not_capability',advisoryOnly:true};

  const { measureCalibration } = require('./dojoCalibration');
  const calibration = measureCalibration(entries);

  // End-to-end efficiency, kept distinct from author self-scores:
  // candidate ideas screened internally vs ideas shown vs actual user passes.
  const screenedTrials = (trials || []).filter((t) => t.editorialScreen?.pool?.length);
  const screening = {
    submitted: screenedTrials.length,
    considered: screenedTrials.reduce((n, t) => n + t.editorialScreen.candidateCount, 0),
    rejectedBeforeUser: screenedTrials.reduce((n, t) => n + t.editorialScreen.rejectedCount, 0),
    rated: screenedTrials.filter((t) => t.status === 'rated').length,
    userPass: screenedTrials.filter((t) => t.status === 'rated' && t.verdict === 'pass').length,
  };
  screening.passRate = rateOf(screening.userPass, screening.rated);
  // Pass rate by the pre-registered closing type, so the two kinds of ending can be compared.
  const closings = {};
  screenedTrials.filter((t) => t.editorialScreen.closingType).forEach((t) => {
    const row = closings[t.editorialScreen.closingType] || (closings[t.editorialScreen.closingType] = { submitted: 0, rated: 0, userPass: 0 });
    row.submitted += 1;
    if (t.status === 'rated') { row.rated += 1; if (t.verdict === 'pass') row.userPass += 1; }
  });
  Object.values(closings).forEach((row) => { row.passRate = rateOf(row.userPass, row.rated); });
  if (Object.keys(closings).length) screening.byClosingType = closings;

  const byHypothesis = new Map();
  entries.forEach((e) => e.hypothesisIds.forEach((id) => byHypothesis.set(id, [...(byHypothesis.get(id) || []), e])));
  const titles = new Map((hypotheses || []).map((h) => [h.id, h]));
  // A failure hypothesis is measured by risk clearance and missed risks, never by the positive pass-rate scoreboard.
  const negativeLearning = negativeLearningView(trials || [], base, hypotheses || []);
  const scoreboard = [...byHypothesis.entries()].filter(([id]) => titles.get(id)?.polarity !== 'negative').map(([id, list]) => ({
    id, title: titles.get(id)?.title || '', status: titles.get(id)?.status || 'open', ...tally(list),
  })).sort((a, b) => b.rated - a.rated || String(a.id).localeCompare(String(b.id)));

  const refinement = refinementView(entries, (hypotheses || []).filter(h => h.polarity !== 'negative'));
  const learning = learningView(trials || [], feedbackLog || [], hypotheses || [], base?.progress);
  const failStages = {};
  entries.filter((e) => e.verdict !== 'pass' && e.failStage).forEach((e) => { failStages[e.failStage] = (failStages[e.failStage] || 0) + 1; });

  const failStreak = failStreakOf(entries);
  const lastRatedAt = entries.length ? entries[entries.length - 1].at : null;
  // A completed run alone is not research. Only a structured, evidence-referenced
  // postmortem made AFTER the latest non-pass clears the resourcing/revision gate.
  const diagnosticRun = (base?.lastRuns || []).find((run) => run.failureAnalysisRecorded === true
    && run.finishedAt && lastRatedAt && String(run.finishedAt) >= String(lastRatedAt));
  const measurementMode = base?.outcome?.confirmedBy === 'measurement';
  const researchDue = !measurementMode && failStreak >= LIMITS.failStreak && !diagnosticRun;
  // Historical withdrawn/rated samples must not require new human ratings in an evidence-led dojo.
  const usesTrials = !measurementMode && (trials || []).length > 0;
  const canRelease = !usesTrials || current.rated >= LIMITS.minRatedPerVersion;

  const nextActions = [];
  if (!measurementMode && learning.status === 'contrast_ready') {
    if (negativeLearning.status === 'not_registered') nextActions.push('全道場共通: 本人の合格・不採用の原文を対照し、失敗しやすい条件の仮説を polarity=negative として登録する。次のrunでは正のtargetsとnegativeTargetsを同時に宣言する。');
    else if (negativeLearning.unreviewedRated > 0) nextActions.push('退屈化/失敗仮説を次のrunのnegativeTargetsで並走し、候補ごとのnegativeReviewを記録する。古い未検証稿は事後判定で合格にしない。');
    if (negativeLearning.clearedButRejected) nextActions.push('負の品質ゲートの見逃し: negativeReviewでclearedとした稿に本人不採用が ' + negativeLearning.clearedButRejected + ' 件。対応する失敗仮説と素材選定を反証する。');
  }
  if (learning.status === 'contrast_ready') {
    nextActions.push('学習対照: 過去の本人合格/不採用の原文を loop.learning から読み、成立条件と不成立条件を比較してから次の見本を選ぶ。仮説名を貼るだけでは不十分。');
  }
  const missingArtifacts = awaiting.filter(t => !trialArtifactStatus(t).ready);
  if (missingArtifacts.length) nextActions.push('実物未登録の見本 ' + missingArtifacts.map(t => t.id).join(', ')
    + ' は本人評価の前に完成した画像・動画の恒久HTTPS URLを登録する。説明文や一時sandbox参照で合格を取らない。');
  if (awaiting.length - missingArtifacts.length > 0)
    nextActions.push('評価可能な見本が ' + (awaiting.length - missingArtifacts.length) + ' 件ある。新しい見本より先に、本人の評価をもらう。');
  if (researchDue) nextActions.push(failStreak + ' 回続けて合格が出ていない。次の見本・方法版の更新前に、実例の否定的評価と対照例、異なる原因仮説2つ、各反証条件、不確実性を failureAnalysis に記録した研究runを終了する。単なるrun完了では解除しない。');
  scoreboard.filter((h) => h.status === 'open' && h.rated >= LIMITS.hypothesisMinTrials && h.pass === 0)
    .forEach((h) => nextActions.push(h.id + ' は ' + h.rated + ' 回試して合格 0。棄却する（exploration_item_upsert status=rejected）。'));
  scoreboard.filter((h) => h.status === 'open' && h.rated >= LIMITS.hypothesisMinTrials && h.passRate >= 0.6)
    .forEach((h) => nextActions.push(h.id + ' は合格率 ' + Math.round(h.passRate * 100) + '%（' + h.rated + ' 回）。勝ち筋の候補。本文に入れるなら、既存の規則を書き換え・統合して入れる（末尾への追記はしない）。'));
  if(capabilityHealth.comparisons.some(c=>c.status==='regression_alert')) nextActions.push('同一ベンチマークの実力測定で悪化の可能性。規則差分・素材条件を監査し、独立した差戻し案を審査する。');
  if(!measurementMode&&!lanes.current.capability.rated)nextActions.push('承認版の実力は未測定。次回の適切な周回で新規素材を事前登録し、探索と別に capability を測る。');
  if (usesTrials && !canRelease) nextActions.push('いまの版の評価は ' + current.rated + ' 件。' + LIMITS.minRatedPerVersion + ' 件たまるまで版を上げない。');
  if (previous && current.rated >= LIMITS.minRatedPerVersion && current.passRate < previous.passRate) {
    nextActions.push('探索も含む混合評価の合格率 ' + Math.round(current.passRate * 100) + '% は、前の版 ' + previous.version + ' の ' + Math.round(previous.passRate * 100) + '% を下回っている。実力の悪化とは断定せず、比較可能な実力測定と規則差分を点検する。');
  }

  return {
    metric: measurementMode ? 'measured_outcome' : 'pass_rate',
    overall: tally(entries),
    recent: tally(entries.slice(-10)),
    current, previous, byVersion, releaseHealth, lanes, capabilityHealth, metaLearning:metaUsage(trials||[]),metaLearningProjectionVersion:2,
    awaiting: awaiting.map((t) => ({ id: t.id, label: t.label, body: t.body || '',
      ref: t.ref || '', imageUrl: t.imageUrl || '', mediaUrl: t.mediaUrl || '',
      reviewStatus: trialArtifactStatus(t).status, reviewReason: trialArtifactStatus(t).reason,
      createdAt: t.createdAt, hypothesisIds: t.hypothesisIds || [], predictedPass: t.predictedPass ?? null })),
    calibration, screening, learning, negativeLearning, refinement, hypotheses: scoreboard.slice(0, 20), failStages, failStreak,
    gates: { ...LIMITS, measurementMode, usesTrials, ratedOnCurrent: current.rated, canReleaseNewVersion: canRelease, researchDueBeforeNextTrial: researchDue },
    lastRated: entries.slice(-8).reverse().map((e) => ({ id: e.id, label: e.label, verdict: e.verdict, version: versionKey(e), at: e.at, userWords: e.userWords })),
    nextActions,
  };
}

// What the list and World Home carry: small enough to cache on the base document.
function loopSummary(view) {
  return {
    rated: view.overall.rated, pass: view.overall.pass, passRate: view.overall.passRate,
    recentRated: view.recent.rated, recentPassRate: view.recent.passRate,
    currentVersion: view.current.version, currentRated: view.current.rated, currentPassRate: view.current.passRate,
    previousVersion: view.previous?.version || null, previousPassRate: view.previous?.passRate ?? null,
    awaiting: view.awaiting.length, failStreak: view.failStreak,
    capabilityRated:view.lanes.current.capability.rated,capabilityPassRate:view.lanes.current.capability.passRate,
    explorationRated:view.lanes.current.exploration.rated,explorationPassRate:view.lanes.current.exploration.passRate,
    validationRated:view.lanes.current.validation.rated,validationPassRate:view.lanes.current.validation.passRate,
    metaLearning:view.metaLearning||[],
    metaLearningProjectionVersion:view.metaLearningProjectionVersion||null,
    hitRate: view.calibration?.hitRate ?? null,
    screening: view.screening,
    negativeLearning: { status: view.negativeLearning.status,
      negativeHypotheses: view.negativeLearning.negativeHypotheses, reviewed: view.negativeLearning.reviewed,
      clearedButRejected: view.negativeLearning.clearedButRejected,
      screenedOutUnverified: view.negativeLearning.screenedOutUnverified,
      insufficientHumanContrast: view.negativeLearning.insufficientHumanContrast,
      legacyDerivedReviewed: view.negativeLearning.legacyDerivedReviewed },
    learning: {
      status: view.learning.status, acceptedCount: view.learning.acceptedCount,
      rejectedCount: view.learning.rejectedCount,
      promisingHypotheses: view.learning.promisingHypotheses.slice(0, 3).map(h => ({ id: h.id, rated: h.rated, pass: h.pass, adjustedPassRate: h.adjustedPassRate })),
      auditCoverage: view.learning.auditCoverage,
    },
  };
}

module.exports = { loopView, loopSummary, ratedEntries, VERDICTS, FAIL_STAGES, LIMITS };
