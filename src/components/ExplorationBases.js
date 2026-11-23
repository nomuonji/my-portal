import React, { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Alert, Box, Button, CircularProgress, Collapse, Dialog, DialogActions, DialogContent, DialogTitle,
  Link, Stack, Tab, Tabs, TextField, Typography,
} from '@mui/material';
import { ArrowBack, OpenInNew, Refresh } from '@mui/icons-material';
import { marked } from 'marked';
import { auth } from '../firebase';
import { toText } from './jobOpportunityView';

// スキル錬成道場 (exploration bases). Each one trains a DB skill or pack. Status and anything waiting for the user stay on top; the rest of the base is split into
// tabs (goal, timeline, guesses, constraints, method) so each part is read on its own.

const V = {
  ink: 'var(--p-ink)', muted: 'var(--p-muted)', faint: 'var(--p-faint)', rule: 'var(--p-rule)',
  accent: 'var(--p-accent)', accentSoft: 'var(--p-accent-soft)', amber: 'var(--p-amber)',
  blue: 'var(--p-blue)', green: 'var(--p-green)', pink: 'var(--p-pink)',
};

const STAGE = {
  yielded_outcome: { label: '成果につながった', color: V.green, rank: 0 },
  yielded_candidate: { label: '候補を生んだ', color: V.green, rank: 1 },
  reproduced: { label: '別の対象でも再現', color: V.blue, rank: 2 },
  observed: { label: '一度観測', color: V.amber, rank: 3 },
  conjecture: { label: '推測', color: V.faint, rank: 4 },
};
// Same ladder, worded for where material comes from.
const SOURCE_STAGE = {
  yielded_outcome: { label: '成果を生んだ', color: V.green },
  yielded_candidate: { label: '候補を生んだ', color: V.green },
  reproduced: { label: '複数回で有用', color: V.blue },
  observed: { label: '一度有用', color: V.amber },
  conjecture: { label: '未検証', color: V.faint },
};
const OWNER = { user: 'あなたが決めたこと', environment: '道具やデータの限界', agent: 'エージェントの進め方' };
const VERDICT = { supported: '当たり', contradicted: '外れ', inconclusive: '判定できず' };
const EVENT_LABEL = {
  base_created: '道場を作成', base_described: '名前・説明を変更', outcome_set: 'ゴールを変更',
  outcome_proposed: 'ゴールの変更を提案', method_version_set: 'スキルの版を更新', hypothesis_created: '見立てを追加',
  hypothesis_updated: '見立てを更新', source_created: '情報源を追加', source_updated: '情報源を更新',
  hypothesis_stage: '見立ての検証度が変化', source_stage: '情報源の検証度が変化', hypothesis_status: '見立てを棄却・引退', source_status: '情報源を外す',
  constraint_status: '制約の扱いを変更', constraint_created: '制約を追加', constraint_updated: '制約を更新',
  run_started: '実行を開始', run_finished: '実行（進展あり）', run_stalled: '実行（空振り）', run_abandoned: '実行を中断',
  achievement_confirmed: '成果を確定', achievement_declined: '候補を見送り',
  status_active: '再開', status_paused: '一時停止', status_closed: '終了',
};

async function api(path = '', body = null) {
  const user = auth.currentUser;
  if (!user) throw new Error('My Portal にログインしてください');
  const response = await fetch('/api/agent-ideas' + path, {
    method: body ? 'POST' : 'GET',
    headers: { Authorization: 'Bearer ' + await user.getIdToken(), 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || '通信に失敗しました (' + response.status + ')');
  return data;
}

function shortDate(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric' }).format(date);
}

function methodUrl(bodyRef) {
  const location = String(bodyRef?.location || '').replace(/^github:/, '').trim();
  if (/^https?:\/\//.test(location)) return location;
  if (bodyRef?.kind === 'repo' && /^[\w.-]+\/[\w.-]+$/.test(location)) {
    return 'https://github.com/' + location + (bodyRef.path ? '/blob/' + (bodyRef.commit || 'main') + '/' + bodyRef.path : '');
  }
  return '';
}

// One sentence for "where does this stand", shared by the list and the detail page.
export function statusOf(state) {
  if (state.status === 'paused') return { text: '一時停止中です', color: V.faint };
  if (state.status === 'closed') return { text: 'この探索は終了しています', color: V.faint };
  if (state.loop?.awaiting > 0) return { text: 'あなたの評価を待っている見本が ' + state.loop.awaiting + ' 件あります', color: V.accent };
  if (state.awaitingCount > 0) return { text: 'あなたの判断を待っている候補が ' + state.awaitingCount + ' 件あります', color: V.accent };
  if (state.pendingProposalCount > 0) return { text: 'ゴールの変更提案が ' + state.pendingProposalCount + ' 件届いています', color: V.accent };
  if (state.loop?.failStreak >= 3) return { text: state.loop.failStreak + ' 回続けて合格が出ていません。仕入れ方から見直しています', color: V.pink };
  if (state.stalledRuns >= 3) return { text: state.stalledRuns + ' 回続けて進展がありません。進め方の見直しが必要です', color: V.pink };
  if (state.openRunId) return { text: 'いま探索を実行しています', color: V.blue };
  if (!state.runCount) return { text: 'まだ一度も実行していません', color: V.faint };
  const last = state.lastRun;
  return {
    text: '最後の実行は ' + shortDate(last?.finishedAt) + '（' + (last?.moved === false ? '空振り' : '進展あり') + '）',
    color: last?.moved === false ? V.amber : V.green,
  };
}

function Dot({ color }) {
  return <Box component="span" aria-hidden sx={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: color, flexShrink: 0, mt: '0.55em' }} />;
}

function Status({ state, size = 14 }) {
  const { text, color } = statusOf(state);
  return (
    <Stack direction="row" gap={0.8} alignItems="flex-start">
      <Dot color={color} />
      <Typography sx={{ fontSize: size, fontWeight: 700, color: color === V.faint ? V.muted : V.ink, lineHeight: 1.6 }}>{text}</Typography>
    </Stack>
  );
}

const percent = (rate) => (rate === null || rate === undefined ? '—' : Math.round(rate * 100) + '%');

// The measure of a 道場: how often the user passes what the version in use produces. No count target.
// `loop` is the summary carried by the list (rated, passRate, currentVersion, currentRated, currentPassRate).
export function PassRate({ loop, big = false }) {
  const rated = loop?.rated || 0;
  const onCurrent = loop?.currentRated || 0;
  // An unrated current release is not measured, even when older releases
  // achieved passes. Never display historical rates as the current verdict.
  const shown = onCurrent > 0 ? loop.currentPassRate : null;
  return (
    <Box sx={{ textAlign: { xs: 'left', md: 'right' } }}>
      <Typography sx={{ fontSize: big ? 34 : 24, fontWeight: 900, lineHeight: 1, letterSpacing: '-0.02em' }}>{percent(shown)}</Typography>
      <Typography sx={{ fontSize: 11.5, color: V.muted, mt: 0.5 }}>
        {onCurrent > 0 ? '現行版の本人合格率（' + onCurrent + '件）' : '現行版はまだ評価なし（0件）'}
      </Typography>
      {rated > onCurrent && <Typography sx={{ fontSize: 11.5, color: V.faint, mt: 0.2 }}>全履歴の合格率 {percent(loop.passRate)}（{rated}件、現行版とは別）</Typography>}
    </Box>
  );
}

function Heading({ children, aside }) {
  return (
    <Stack direction="row" justifyContent="space-between" alignItems="baseline" gap={1} sx={{ mt: 4, mb: 1, pb: 0.8, borderBottom: '1px solid ' + V.rule }}>
      <Typography component="h2" sx={{ fontSize: 16, fontWeight: 800 }}>{children}</Typography>
      {aside}
    </Stack>
  );
}

function Quiet({ children }) {
  return <Typography sx={{ fontSize: 13.5, color: V.muted, py: 1 }}>{children}</Typography>;
}

function Small({ children }) {
  return <Typography component="span" sx={{ fontSize: 11.5, color: V.faint }}>{children}</Typography>;
}

// ---- Building blocks --------------------------------------------------------

// The method body is Markdown written by the user or an agent. Raw HTML is escaped before parsing.
function MarkdownBody({ source }) {
  const html = marked.parse(String(source || '').replace(/&/g, '&amp;').replace(/</g, '&lt;'), { async: false });
  return (
    <Box className="method-body" dangerouslySetInnerHTML={{ __html: html }} sx={{
      fontSize: 14, lineHeight: 1.75, color: V.ink, overflowWrap: 'anywhere',
      '& h1': { fontSize: 18, fontWeight: 850, mt: 2, mb: 1 },
      '& h2': { fontSize: 15.5, fontWeight: 800, mt: 3, mb: 1, pb: 0.5, borderBottom: '1px solid ' + V.rule },
      '& h3': { fontSize: 14, fontWeight: 800, mt: 2, mb: 0.6 },
      '& p': { my: 1 }, '& ul, & ol': { pl: 3, my: 1 }, '& li': { my: 0.4 },
      '& code': { fontFamily: '"JetBrains Mono", ui-monospace, monospace', fontSize: 12.5, background: 'var(--p-sunken)', px: 0.5, borderRadius: 0.5 },
      '& table': { display: 'block', overflowX: 'auto', borderCollapse: 'collapse', my: 1.5, fontSize: 13 },
      '& th, & td': { border: '1px solid ' + V.rule, px: 1.2, py: 0.7, textAlign: 'left', verticalAlign: 'top' },
      '& th': { background: 'var(--p-sunken)', fontWeight: 800 },
    }} />
  );
}

function DetailRow({ label, children }) {
  if (children === null || children === undefined || children === '' || (Array.isArray(children) && !children.length)) return null;
  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '120px minmax(0,1fr)' }, columnGap: 2, py: 1, borderBottom: '1px solid ' + V.rule }}>
      <Typography sx={{ fontSize: 12.5, color: V.muted }}>{label}</Typography>
      <Box sx={{ fontSize: 13.5, lineHeight: 1.65, minWidth: 0, overflowWrap: 'anywhere' }}>{children}</Box>
    </Box>
  );
}

function evidenceOf(item) {
  return { hits: (item.evidence || []).filter((entry) => entry.type === 'candidate' || entry.type === 'outcome').length };
}

function LedgerDetail({ item, stages = STAGE }) {
  const [open, setOpen] = useState(false);
  const closed = item.status !== 'open';
  const isSource = item.kind === 'source';
  const stage = stages[item.stage] || { label: item.stage, color: V.faint };
  const evidence = item.evidence || [];
  const counter = item.counterexamples || [];
  return (
    <Box sx={{ py: 1.2, borderBottom: '1px solid ' + V.rule }}>
      <Stack direction="row" gap={1} alignItems="baseline" flexWrap="wrap">
        <Typography sx={{ fontSize: 14, fontWeight: 750 }}>{item.title}</Typography>
        <Small>{closed ? (item.status === 'rejected' ? (isSource ? '外した' : '棄却') : '引退') : stage.label}</Small>
        {isSource && evidenceOf(item).hits > 0 && <Small>候補 {evidenceOf(item).hits}</Small>}
        {isSource && (item.counterexamples || []).length > 0 && <Small>空振り {(item.counterexamples || []).length}</Small>}
      </Stack>
      {isSource && item.locator && (
        /^https?:\/\//.test(item.locator)
          ? <Link href={item.locator} target="_blank" rel="noreferrer" sx={{ fontSize: 12, overflowWrap: 'anywhere' }}>{item.locator}</Link>
          : <Typography sx={{ fontSize: 12, color: V.faint, overflowWrap: 'anywhere' }}>{item.locator}</Typography>
      )}
      <Typography sx={{ fontSize: 13, color: V.muted, mt: 0.3, lineHeight: 1.65 }}>
        {closed ? (item.statusReason || item.statement || item.coverage) : (isSource ? item.coverage : item.statement)}
      </Typography>
      {(item.mechanism || item.limits || evidence.length > 0 || counter.length > 0) && (
        <>
          <Button size="small" onClick={() => setOpen((v) => !v)} sx={{ px: 0, minWidth: 0, fontSize: 12, color: V.faint }}>
            {open ? '閉じる' : '根拠を見る'}
          </Button>
          <Collapse in={open} unmountOnExit>
            <Box sx={{ pl: 1.5, borderLeft: '2px solid ' + V.rule, fontSize: 12.5, lineHeight: 1.65 }}>
              {item.mechanism && <Box sx={{ mb: 0.6 }}>なぜ：{item.mechanism}</Box>}
              {!closed && item.limits && <Box sx={{ mb: 0.6 }}>限界：{item.limits}</Box>}
              {evidence.map((entry, index) => (
                <Box key={'e' + index} sx={{ mb: 0.6 }}>
                  {toText(entry.ref)} <Small>{entry.date}</Small>
                  {/^https?:\/\//.test(entry.source || '') && <> <Link href={entry.source} target="_blank" rel="noreferrer" sx={{ fontSize: 11.5 }}>出典</Link></>}
                </Box>
              ))}
              {counter.map((entry, index) => <Box key={'c' + index} sx={{ mb: 0.6, color: V.pink }}>{isSource ? '空振り' : '反例'}：{toText(entry.ref || entry)}</Box>)}
            </Box>
          </Collapse>
        </>
      )}
    </Box>
  );
}

function Ledger({ items, stages, empty, closedLabel, closedNote }) {
  const open = items.filter((item) => item.status === 'open');
  const closed = items.filter((item) => item.status !== 'open');
  return (<>
    {Object.keys(stages).map((key) => {
      const list = open.filter((item) => item.stage === key);
      if (!list.length) return null;
      return (
        <Box key={key} sx={{ mt: 1.5 }}>
          <Typography sx={{ fontSize: 12.5, fontWeight: 800, color: stages[key].color }}>{stages[key].label} <Small>{list.length}</Small></Typography>
          {list.map((item) => <LedgerDetail key={item.id} item={item} stages={stages} />)}
        </Box>
      );
    })}
    {!open.length && <Quiet>{empty}</Quiet>}
    {closed.length > 0 && (
      <Box sx={{ mt: 2 }}>
        <Typography sx={{ fontSize: 12.5, fontWeight: 800, color: V.muted }}>{closedLabel} <Small>{closed.length}　{closedNote}</Small></Typography>
        {closed.map((item) => <LedgerDetail key={item.id} item={item} stages={stages} />)}
      </Box>
    )}
  </>);
}

// ---- Detail page ------------------------------------------------------------
// Status and decisions on top; then one tab per part. The goal tab is the only place the pass criteria
// live; 経過 merges the exploration runs and the changes to the base into one dated list.

function Run({ run, hypotheses }) {
  const stalled = run.status === 'finished' && run.moved === false;
  return (
    <Box sx={{ py: 1.1, borderBottom: '1px solid ' + V.rule }}>
      <Stack direction="row" gap={1} alignItems="baseline" flexWrap="wrap">
        <Small>{shortDate(run.startedAt)}</Small>
        <Typography component="span" sx={{ fontSize: 12, fontWeight: 800, color: run.status === 'open' ? V.blue : stalled ? V.pink : run.status === 'abandoned' ? V.faint : V.green }}>
          {run.status === 'open' ? '実行中' : stalled ? '空振り' : run.status === 'abandoned' ? '中断' : '進展あり'}
        </Typography>
        <Typography sx={{ fontSize: 14, fontWeight: 700 }}>{run.objective}</Typography>
      </Stack>
      {(run.summary || run.notMovedReason) && <Typography sx={{ fontSize: 13, color: V.muted, mt: 0.3, lineHeight: 1.6 }}>{run.summary || run.notMovedReason}</Typography>}
      {(run.verdicts || []).length > 0 && (
        <Typography sx={{ fontSize: 12, color: V.faint, mt: 0.3 }}>
          {run.verdicts.map((verdict) => {
            const title = hypotheses.find((item) => item.id === verdict.hypothesisId)?.title || verdict.hypothesisId;
            return title + '：' + (VERDICT[verdict.result] || verdict.result);
          }).join('　')}
        </Typography>
      )}
      {run.nextStep && <Typography sx={{ fontSize: 12, color: V.muted, mt: 0.3 }}>次の一手：{run.nextStep}</Typography>}
    </Box>
  );
}

const TABS = [
  { key: 'goal', label: 'ゴール' }, { key: 'graph', label: '仮説の系譜' }, { key: 'timeline', label: '経過' }, { key: 'guesses', label: '見立て' },
  { key: 'sources', label: '情報源' }, { key: 'constraints', label: '制約' }, { key: 'method', label: 'スキル本文' },
];
// Run start/finish events duplicate the run entries themselves, so the timeline leaves them out.
const RUN_EVENTS = new Set(['run_started', 'run_finished', 'run_stalled', 'run_abandoned']);

// Explorations (runs) and changes to the base, newest first, in one list.
function timelineOf(runs, events) {
  return [
    ...runs.map((run) => ({ kind: 'run', at: run.startedAt, key: 'run-' + run.id, run })),
    ...events.filter((event) => !RUN_EVENTS.has(event.type)).map((event) => ({ kind: 'change', at: event.createdAt, key: 'e-' + event.seq, event })),
  ].sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')));
}

const VERDICT_LABEL = { pass: '合格', partial: '惜しい', fail: 'ボツ' };

// Pictures a card shows: the sample's imageUrl, then any image URLs written in its body.
const IMAGE_URL = /https:\/\/[^\s"'<>()]+?\.(?:jpe?g|png|webp|gif|avif)(?:\?[^\s"'<>()]*)?/gi;
export function cardImages(trial) {
  const urls = [trial.imageUrl, ...String(trial.body || '').match(IMAGE_URL) || []]
    .filter((url) => /^https:\/\//.test(url || ''));
  return [...new Set(urls)].slice(0, 4);
}
function bodyWithoutImages(body) {
  return String(body || '').replace(IMAGE_URL, '').replace(/[ \t]+\n/g, '\n').trim();
}

// Name the link by where it goes, so a product page reads as one.
function linkLabel(url) {
  let host = '';
  try { host = new URL(url).hostname.replace(/^www\./, ''); } catch (error) { return 'リンクを開く'; }
  if (/(^|\.)(rakuten\.co\.jp|amazon\.co\.jp|amazon\.com|shopping\.yahoo\.co\.jp|amzn\.to|a\.r10\.to|hb\.afl\.rakuten\.co\.jp)$/.test(host)) return '商品ページを開く（' + host + '）';
  return 'リンクを開く（' + host + '）';
}

// Stage verdicts across several examples and send one batch. Leaving rows unselected is allowed.
export function RateTrials({ items, onRate, onRateBatch, busyId, showBase = false }) {
  const [comments, setComments] = useState({});
  const [selections, setSelections] = useState({});
  if (!items?.length) return null;
  const batchMode = Boolean(onRateBatch) && items.length > 1;
  const busy = Boolean(busyId);
  const selectedRows = batchMode ? items.filter((trial) =>
    trial.reviewStatus !== 'artifact_missing' && trial.reviewStatus !== 'artifact_temporary'
    && selections[trial.baseId + ':' + trial.id]).map((trial) => {
    const key = trial.baseId + ':' + trial.id;
    return { baseId: trial.baseId, id: trial.id, verdict: selections[key], comment: (comments[key] || '').trim(), key };
  }) : [];
  return (
    <Box>
      {items.map((t) => {
        const key = t.baseId + ':' + t.id;
        const comment = comments[key] || '';
        const artifactMissing = ['artifact_missing', 'artifact_temporary'].includes(t.reviewStatus);
        return (
          <Box key={key} sx={{ py: 1.6, borderBottom: '1px solid ' + V.rule }}>
            {showBase && t.baseTitle && <Typography sx={{ fontSize: 11.5, color: V.accent, fontWeight: 800, mb: 0.3 }}>{t.baseTitle}</Typography>}
            <Typography sx={{ fontSize: 14.5, fontWeight: 800, lineHeight: 1.5 }}>{t.label}</Typography>
            {cardImages(t).length > 0 && (
              <Stack direction="row" gap={1} sx={{ mt: 0.8, flexWrap: 'wrap' }}>
                {cardImages(t).map((src, index) => (
                  <Box key={src} component="a" href={src} target="_blank" rel="noreferrer" sx={{ display: 'block', lineHeight: 0 }}>
                    <Box component="img" src={src} alt={t.label + ' の画像' + (index ? ' ' + (index + 1) : '')} loading="lazy" referrerPolicy="no-referrer"
                      sx={{ maxWidth: '100%', width: 240, maxHeight: 240, objectFit: 'contain', background: V.accentSoft, borderRadius: 1 }} />
                  </Box>
                ))}
              </Stack>
            )}
            {bodyWithoutImages(t.body) && <Typography sx={{ fontSize: 14, lineHeight: 1.8, mt: 0.6, whiteSpace: 'pre-line', background: V.accentSoft, px: 1.2, py: 0.8 }}>{bodyWithoutImages(t.body)}</Typography>}
            {artifactMissing && (
              <Alert severity="warning" sx={{mt:0.9}}>
                {t.reviewReason || '完成品が未登録です。閲覧できる実物が登録されるまで評価しません。'}
              </Alert>
            )}
            {/^https:\/\//.test(t.mediaUrl || '') && (
              <Button component="a" href={t.mediaUrl} target="_blank" rel="noreferrer"
                size="small" variant="outlined" sx={{mt:0.8}}>完成した画像・動画を開く</Button>
            )}
            {/^https?:\/\//.test(t.ref || '') && (
              <Button component="a" href={t.ref} target="_blank" rel="noreferrer" size="small" variant="outlined" sx={{ mt: 0.8 }}>
                {linkLabel(t.ref)}
              </Button>
            )}
            <Stack direction={{ xs: 'column', sm: 'row' }} gap={1} alignItems={{ xs: 'stretch', sm: 'center' }} sx={{ mt: 1 }}>
              <TextField size="small" placeholder="一言（任意）：ここが嫌、など" value={comment} disabled={busy || artifactMissing}
                onChange={(event) => setComments((all) => ({ ...all, [key]: event.target.value }))}
                inputProps={{ maxLength: 500, 'aria-label': t.label + ' への一言' }} sx={{ flex: 1 }} />
              <Stack direction="row" gap={0.8}>
                {['pass', 'partial', 'fail'].map((verdict) => (
                  <Button key={verdict} size="small" disabled={busy || artifactMissing}
                    aria-pressed={batchMode ? selections[key] === verdict : undefined}
                    variant={batchMode ? (selections[key] === verdict ? 'contained' : 'outlined') : (verdict === 'pass' ? 'contained' : 'outlined')}
                    color={verdict === 'fail' ? 'inherit' : 'primary'}
                    onClick={() => batchMode
                      ? setSelections((all) => ({ ...all, [key]: all[key] === verdict ? undefined : verdict }))
                      : onRate(t, verdict, comment.trim())}>{VERDICT_LABEL[verdict]}</Button>
                ))}
              </Stack>
            </Stack>
          </Box>
        );
      })}
      {batchMode && (
        <Stack direction={{ xs: 'column', sm: 'row' }} alignItems={{ xs: 'stretch', sm: 'center' }} justifyContent="space-between" gap={1.2} sx={{ mt: 2 }}>
          <Stack direction="row" gap={1} alignItems="center">
            <Button size="small" color="inherit" disabled={busy} onClick={() => setSelections((old) => ({
              ...old, ...Object.fromEntries(items.map((t) => [t.baseId + ':' + t.id, 'fail'])),
            }))}>全件ボツを選択</Button>
            <Button size="small" color="inherit" disabled={busy || !selectedRows.length} onClick={() => setSelections({})}>選択解除</Button>
          </Stack>
          <Button variant="contained" disabled={busy || !selectedRows.length}
            onClick={async () => {
              const savedKeys = await onRateBatch(selectedRows);
              if (savedKeys?.length) {
                setSelections((old) => {
                  const next = { ...old };
                  savedKeys.forEach((key) => { delete next[key]; });
                  return next;
                });
              }
            }}>{busyId === 'batch' ? '保存中…' : '選択した ' + selectedRows.length + ' 件をまとめて保存'}</Button>
        </Stack>
      )}
    </Box>
  );
}

// The improvement loop in one block: pass rate by version, what is waiting for the user, and what the last
// ratings were. A version is better only when the user passed more of what it produced.
export function LoopPanel({ loop, baseId, onRate, onRateBatch, busyId }) {
  if (!loop) return null;
  const versions = loop.byVersion || [];
  const awaiting = loop.awaiting || [];
  const lastRated = loop.lastRated || [];
  const calibration = loop.calibration;
  const negativeLearning = loop.negativeLearning;
  const refinement = loop.refinement;
  if (!versions.length && !awaiting.length) return null;
  return (
    <Box sx={{ mt: 2.5 }}>
      <Heading aside={<Small>見本への一言と、潜水艦の成果への評価を、作った版ごとに数えています</Small>}>合格率（版ごと）</Heading>
      {versions.map((g) => (
        <Stack key={g.version} direction="row" gap={1.5} alignItems="baseline" flexWrap="wrap" sx={{ py: 1, borderBottom: '1px solid ' + V.rule }}>
          <Typography sx={{ fontSize: 14.5, fontWeight: 850, minWidth: 150 }}>{g.version}{g.released ? '（いまの版）' : ''}</Typography>
          <Typography sx={{ fontSize: 14.5, fontWeight: 850 }}>{percent(g.passRate)}</Typography>
          <Typography sx={{ fontSize: 13, color: V.green, fontWeight: 800 }}>合格 {g.pass}</Typography>
          {g.partial > 0 && <Typography sx={{ fontSize: 13, color: V.amber, fontWeight: 800 }}>惜しい {g.partial}</Typography>}
          <Typography sx={{ fontSize: 13, color: V.faint, fontWeight: 800 }}>ボツ {g.fail}</Typography>
        </Stack>
      ))}
      {calibration && (
        <Box sx={{ mt: 1.5, px: 1.5, py: 1.1, border: '1px solid ' + V.rule, borderRadius: 1.5 }}>
          <Typography sx={{ fontSize: 13, fontWeight: 800, mb: 0.4 }}>AIの事前予測を検証</Typography>
          <Typography sx={{ fontSize: 12.5, color: V.muted, lineHeight: 1.7 }}>
            本人評価 {calibration.predicted}件。的中率 {percent(calibration.hitRate)} ／
            単純な多数派予測でも {percent(calibration.baselineHitRate)}。
            Brier誤差 {calibration.brier?.toFixed(3)}（小さいほど良い）／
            全履歴の合格率だけを使う同一標本の参考値 {calibration.inSampleBaseRateBrier?.toFixed(3)}。
          </Typography>
          <Typography sx={{ fontSize: 12.5, color: V.muted, lineHeight: 1.7 }}>
            合格すると予測した {calibration.positiveCalls}件のうち正解 {calibration.truePositive}件、
            誤判定 {calibration.falsePositive}件。{calibration.positiveCalls
              ? '合格予測の適中率 ' + percent(calibration.precision) + '。'
              : '合格予測は0件のため、合格作の選別性能は未検証。'}
            {calibration.predictiveStatus === 'no_better_than_base_rate'
              ? ' この標本では単純基準より予測誤差が大きい。'
              : calibration.predictiveStatus === 'no_pass_examples'
                ? ' 合格例がないため良作の識別性能は測定できない。'
                : calibration.predictiveStatus === 'too_few'
                  ? ' 件数が少なく一般化できない。'
                  : ''}
          </Typography>
          <Typography sx={{ fontSize: 11.5, color: V.faint }}>
            同一標本の基準値は事後的な比較で、将来の予測精度や合格率向上の証明ではありません。
            惜しいは合格予測の判定上は不合格に含みます。売上・再生数の測定とも別です。
          </Typography>
        </Box>
      )}
      {negativeLearning && (
        <Box sx={{ mt: 1.5, px: 1.5, py: 1.2, border: '1px solid ' + V.rule, borderRadius: 1.5 }}>
          <Typography sx={{ fontSize: 13.5, fontWeight: 800, mb: 0.4 }}>ネガティブ仮説・棄却ゲート</Typography>
          <Typography sx={{ fontSize: 12.5, color: V.muted, lineHeight: 1.7 }}>
            {negativeLearning.status === 'not_registered'
              ? '失敗を予測する仮説は未登録。採用・ボツの実例を対照してから、次の錬成で正の仮説と同時に検証します。'
              : '失敗仮説 ' + negativeLearning.negativeHypotheses + '件 ／ 本人評価まで進んだ事前審査 ' + negativeLearning.reviewed + '件。'}
          </Typography>
          <Typography sx={{ fontSize: 12.5, color: V.muted, lineHeight: 1.7 }}>
            審査を通したのに本人がボツ・惜しいとした見逃し {negativeLearning.clearedButRejected}件 ／
            内部棄却 {negativeLearning.screenedOutUnverified}件（本人未評価）。
          </Typography>
          {negativeLearning.byHypothesis?.filter(h => h.clearedRated > 0).slice(0, 5).map(h => (
            <Typography key={h.id} sx={{ fontSize: 12, color: V.muted, lineHeight: 1.7 }}>
              ・{h.title}：通過後評価 {h.clearedRated}件、見逃し {h.missedRisk}件
            </Typography>
          ))}
          <Typography sx={{ fontSize: 11.5, color: V.faint, mt: 0.4 }}>
            内部棄却は合格率やボツ数に算入しません。ネガティブ仮説の効果は、次に提示した稿の本人採否で検証します。
          </Typography>
        </Box>
      )}
      {refinement && (
        <Box sx={{ mt: 1.5, px: 1.5, py: 1.3, border: '1px solid ' + V.rule, borderRadius: 1.5 }}>
          <Typography sx={{ fontSize: 13.5, fontWeight: 800, mb: 0.5 }}>次の仮説を選ぶための診断</Typography>
          {refinement.calibration?.count > 0 && (
            <Typography sx={{ fontSize: 12.5, color: V.muted, lineHeight: 1.7 }}>
              事前予測 {refinement.calibration.count}件：
              平均予測 {percent(refinement.calibration.meanPrediction)} ／ 実際の合格 {percent(refinement.calibration.actualPassRate)}。
              {refinement.calibration.meanBias > 0
                ? ' 平均で ' + Math.round(refinement.calibration.meanBias * 100) + 'ポイント楽観的です。'
                : refinement.calibration.meanBias < 0
                  ? ' 平均で ' + Math.round(-refinement.calibration.meanBias * 100) + 'ポイント慎重です。'
                  : ' 平均予測と結果は一致しています。'}
              {refinement.calibration.suggestedAdjustment !== null && refinement.calibration.suggestedAdjustment !== undefined &&
                ' 次回予測の補正参考値 ' + (refinement.calibration.suggestedAdjustment > 0 ? '+' : '') + Math.round(refinement.calibration.suggestedAdjustment * 100) + 'ポイント。'}
            </Typography>
          )}
          {refinement.hypotheses?.length > 0 && (
            <Box sx={{ mt: 0.8 }}>
              <Typography sx={{ fontSize: 12.5, fontWeight: 800 }}>検証を優先したい仮説（未確定）</Typography>
              {refinement.hypotheses.slice(0, 3).map((h) => (
                <Typography key={h.id} sx={{ fontSize: 12.5, color: V.muted, lineHeight: 1.7 }}>
                  ・{h.title}（{h.rated}件評価、縮約推定 {percent(h.predictedPass)}）
                </Typography>
              ))}
            </Box>
          )}
          {refinement.contrast && (
            <Typography sx={{ fontSize: 12.5, color: V.muted, mt: 0.6, lineHeight: 1.7 }}>
              次の比較：{refinement.contrast.hypothesisIds.join(' と ')}。
              {refinement.contrast.confounded
                ? ' 検証工程や評価対象が重なっているため、同じ試作品への採点だけで原因を特定できません。'
                : ' 同じ条件を保ち、変更する工程を一つに絞って検証します。'}
            </Typography>
          )}
          <Typography sx={{ fontSize: 11.5, color: V.faint, mt: 0.5 }}>
            自動計算は仮説の優先順位付けのみ。本人の採否と因果の検証は別です。
          </Typography>
        </Box>
      )}
      {(loop.nextActions || []).length > 0 && (
        <Box sx={{ mt: 1.2 }}>
          {loop.nextActions.map((line) => <Typography key={line} sx={{ fontSize: 12.5, color: V.muted, lineHeight: 1.7 }}>・{line}</Typography>)}
        </Box>
      )}
      {awaiting.length > 0 && (
        <Box sx={{ mt: 1.5 }}>
          <Typography sx={{ fontSize: 13, fontWeight: 800 }}>評価待ちの見本 {awaiting.length}件</Typography>
          {onRate
            ? <RateTrials items={awaiting.map((t) => ({ ...t, baseId }))} onRate={onRate} onRateBatch={onRateBatch} busyId={busyId} />
            : awaiting.map((t) => <Typography key={t.id} sx={{ fontSize: 13, color: V.muted, lineHeight: 1.7 }}>{t.label}</Typography>)}
          <Typography sx={{ fontSize: 12, color: V.faint, mt: 0.5 }}>チャットで一言伝えても同じように記録されます。</Typography>
        </Box>
      )}
      {lastRated.length > 0 && (
        <Box sx={{ mt: 1.5 }}>
          <Typography sx={{ fontSize: 13, fontWeight: 800 }}>直近の評価</Typography>
          {lastRated.map((t) => (
            <Typography key={t.id + String(t.at)} sx={{ fontSize: 12.5, color: V.muted, lineHeight: 1.7 }}>
              <b style={{ color: t.verdict === 'pass' ? 'var(--p-green)' : undefined }}>{VERDICT_LABEL[t.verdict] || t.verdict}</b>　{t.label}
              {t.userWords ? <span style={{ color: 'var(--p-faint)' }}>　「{t.userWords}」</span> : null}
            </Typography>
          ))}
        </Box>
      )}
    </Box>
  );
}

// What the user said about things this 道場's gear produced, grouped by the version that produced them.
// This is the evidence for releasing a new version: a version is better when the user said so more often.
export function VersionFeedback({ feedback }) {
  const groups = feedback?.byVersion || [];
  if (!groups.length) return null;
  return (
    <Box sx={{ mt: 2.5 }}>
      <Heading aside={<Small>潜水艦の成果への評価・コメントが、見つけた版ごとに届きます</Small>}>本人の評価（版ごと）</Heading>
      {groups.map((g) => {
        const decided = (g.confirmed || 0) + (g.declined || 0);
        const rate = decided ? Math.round(((g.confirmed || 0) / decided) * 100) : null;
        return (
          <Box key={String(g.version)} sx={{ py: 1.2, borderBottom: '1px solid ' + V.rule }}>
            <Stack direction="row" gap={1.5} alignItems="baseline" flexWrap="wrap">
              <Typography sx={{ fontSize: 14.5, fontWeight: 850 }}>{g.version === null ? '版の記録なし' : 'v' + g.version}{g.released ? '（いま実行で使う版）' : ''}</Typography>
              <Typography sx={{ fontSize: 13, color: V.green, fontWeight: 800 }}>成果 {g.confirmed || 0}</Typography>
              <Typography sx={{ fontSize: 13, color: V.faint, fontWeight: 800 }}>見送り {g.declined || 0}</Typography>
              <Typography sx={{ fontSize: 13, color: V.amber, fontWeight: 800 }}>評価待ち {g.candidate || 0}</Typography>
              {rate !== null && <Small>判断したもののうち成果 {rate}%</Small>}
            </Stack>
            {(g.comments || []).slice(0, 4).map((c, i) => (
              <Typography key={i} sx={{ fontSize: 12.5, color: V.muted, lineHeight: 1.6, mt: 0.4 }}>
                {c.actionLabel && <b>{c.actionLabel}</b>}{c.actionLabel ? '　' : ''}「{c.text}」<span style={{ color: 'var(--p-faint)' }}>　{c.label}</span>
              </Typography>
            ))}
          </Box>
        );
      })}
    </Box>
  );
}


const PROMOTION_LABEL = {
  unexamined:'未評価', collecting:'検証データ蓄積中',
  promising:'観察的に有望（実証未了）',
  exploratory_partial:'条件付き部分支持の候補',
  validated_scope:'事前登録比較の採用候補（正式採用前）',
  not_supported:'支持不十分', refuted_scope:'対象条件で反証',
  negative_risk_review:'負の仮説：失敗条件を研究',
};

function SkillEvidenceGraph({ baseId }) {
  const [graph,setGraph]=useState(null);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [moduleKey,setModuleKey]=useState(null);
  const [hypothesisKey,setHypothesisKey]=useState(null);
  const load=useCallback(async()=>{
    setBusy(true);setError('');
    try {setGraph(await api('?resource=exploration_skill_graph&id='+encodeURIComponent(baseId)+'&view=full'));}
    catch(e){setError(e.message||'仮説ネットワークを取得できません');}
    finally{setBusy(false);}
  },[baseId]);
  useEffect(()=>{setGraph(null);setModuleKey(null);setHypothesisKey(null);load();},[load]);
  const modules=graph?.modules||[];
  const selectedModule=modules.find(m=>m.id===moduleKey)||modules.find(m=>m.hypothesisIds.length)||modules[0];
  const hypotheses=(graph?.hypotheses||[]).filter(h=>(selectedModule?.hypothesisIds||[]).includes(h.id));
  const selectedHypothesis=hypotheses.find(h=>h.id===hypothesisKey)||hypotheses[0];
  const trials=(graph?.trials||[]).filter(t=>(t.hypothesisIds||[]).includes(selectedHypothesis?.id));
  const edges=(graph?.hypothesisEdges||[]).filter(e=>e.sourceId===selectedHypothesis?.id||e.targetId===selectedHypothesis?.id);
  const stats=selectedHypothesis?.promotion?.historical;
  const boxStyle={border:'1px solid',borderColor:'divider',borderRadius:2,p:1.5,minWidth:0,
    overflowWrap:'anywhere',backgroundColor:'background.paper'};
  return (
    <Box>
      <Stack direction={{xs:'column',sm:'row'}} justifyContent="space-between" alignItems={{sm:'center'}} gap={1} sx={{mb:2}}>
        <Box>
          <Typography sx={{fontWeight:900,fontSize:17}}>Skill → モジュール → 仮説 → 評価物</Typography>
          <Typography sx={{fontSize:12.5,color:V.muted,mt:0.4}}>
            既存のH/T番号と本人評価をそのまま参照。旧データの意味的な分類は暫定で、AIの支持判定を正式証明として扱いません。
          </Typography>
        </Box>
        <Button size="small" variant="outlined" disabled={busy} onClick={load}>{busy?'照合中…':'最新の実証を再集計'}</Button>
      </Stack>
      {error&&<Alert severity="warning" sx={{mb:2}}>{error}</Alert>}
      {busy&&!graph&&<CircularProgress size={22} sx={{m:2}}/>}
      {graph&&(
        <>
          {!!graph.stewardship?.qualityReview?.quarantinedNegativeReviews?.length&&(
            <Alert severity="warning" sx={{mb:2}}>
              負の事前審査が本人評価を予測できていません：
              {graph.stewardship.qualityReview.quarantinedNegativeReviews.map(x=>
                ' '+x.hypothesisId+'（通過後に本人ボツ '+x.clearedRejected+'/'+x.clearedRated+'）').join('、')}。
              これらの「問題なし」判定は現在のBuzz錬成では採用せず、別の失敗仮説・新しい検証条件へ切り替えます。
              {graph.stewardship.qualityReview.recoveryMode?
                ' 連続不合格中のため、原典の直接確認・別枝の対立比較・事前試験計画が必須です。':''}
            </Alert>
          )}
          {!!graph.stewardship?.feedbackReview?.pendingCount&&(
            <Alert severity="warning" sx={{mb:2}}>
              新しい本人評価 {graph.stewardship.feedbackReview.pendingCount}件によるツリー再整理が必要です。
              次の研究runで対象Hの反例・条件を横断比較して、各枝の維持／分割／修正／統合／引退と反証条件を記録してください。
              {graph.stewardship.feedbackReview.overflowCount>0?' 履歴レビュー待ちが上限を超えています。':''}
            </Alert>
          )}
          {!!graph.skillRules?.rules?.length&&(
            <Box sx={{border:'1px solid',borderColor:'divider',borderRadius:2,p:1.5,mb:2}}>
              <Typography sx={{fontWeight:900,fontSize:13.5}}>Skill規則の変更候補と機械審査</Typography>
              <Stack gap={0.7} sx={{mt:1}}>
                {graph.skillRules.rules.map(rule=>(
                  <Box key={rule.id} sx={{p:1,border:'1px solid',borderColor:'divider',borderRadius:1.5}}>
                    <Typography sx={{fontSize:12.5,fontWeight:800}}>
                      {rule.id} · {rule.action} · {rule.moduleId} →
                      {rule.eligibility.evidenceEligible?' 実証条件を満たした検討候補':' 証拠不足・保留'}
                    </Typography>
                    <Typography sx={{fontSize:11.5,color:V.muted,mt:0.35}}>
                      仮説：{rule.hypothesisIds.join(', ')} /
                      根拠判定：{rule.eligibility.blockingReasons.join(', ')||'比較条件クリア'}
                    </Typography>
                    {!!rule.replacementText&&<Typography sx={{fontSize:12.2,mt:0.5,whiteSpace:'pre-wrap'}}>{rule.replacementText}</Typography>}
                  </Box>
                ))}
              </Stack>
              <Typography sx={{fontSize:11.5,color:V.muted,mt:0.7}}>規則の候補は正式Skill本文ではありません。採用には版差分と既存のリリースゲートが必要です。</Typography>
            </Box>
          )}
          {!!graph.stewardship&&(
            <Box sx={{border:'1px solid',borderColor:'divider',borderRadius:2,p:1.5,mb:2,background:V.accentSoft}}>
              <Typography sx={{fontSize:13.5,fontWeight:900}}>Agent のツリー管理・次の研究枝</Typography>
              <Typography sx={{fontSize:12.2,color:V.muted,mt:0.35}}>
                現時点の機械的な研究候補。AIが全履歴・対立仮説を再確認したうえで試験計画と評価物を作る。
                未評価 {graph.stewardship.userReview.awaiting}件 / 新規提示の推奨上限 {graph.stewardship.userReview.suggestedVisibleBatchSize}件。
              </Typography>
              <Stack direction={{xs:'column',md:'row'}} gap={1} sx={{mt:1.2}}>
                {graph.stewardship.portfolio.selectedBranches.map(b=>(
                  <Box key={b.hypothesisId} sx={{flex:1,p:1.1,border:'1px solid',borderColor:'divider',
                    borderRadius:1.5,background:'background.paper'}}>
                    <Typography sx={{fontSize:12.5,fontWeight:800}}>{b.hypothesisId} · {b.moduleId}</Typography>
                    <Typography sx={{fontSize:11.5,color:V.muted,mt:0.3}}>
                      {PROMOTION_LABEL[b.state]||b.state} / {b.intent.replace(/_/g,' ')}
                    </Typography>
                    <Typography sx={{fontSize:11.3,color:V.muted,mt:0.3}}>本人評価 {b.rated}件（合格 {b.pass} / ボツ {b.fail}）</Typography>
                  </Box>
                ))}
              </Stack>
              <Typography sx={{fontSize:11.5,color:V.muted,mt:0.9}}>
                AI：複数枝を手入れ・複数評価物を制作 → 本人：合否 → システム：支持/昇格候補を計算。
                Skill規則の自動マージは未実装。
              </Typography>
            </Box>
          )}
          <Box sx={{overflowX:'auto',pb:1}}>
            <Box sx={{minWidth:1000,display:'grid',gridTemplateColumns:'190px 205px minmax(270px,1fr) minmax(270px,1fr)',gap:1.7,alignItems:'start'}}>
              <Box sx={{...boxStyle,background:'#FFF6DD',borderColor:'#E9CA83'}}>
                <Typography sx={{fontSize:11.5,fontWeight:800,color:'#916615'}}>SKILL / PACK 本体</Typography>
                <Typography sx={{fontWeight:900,fontSize:15,mt:1,overflowWrap:'anywhere'}}>
                  {graph.target.id||'道場の方法論'}
                </Typography>
                <Typography sx={{fontSize:12,color:V.muted,mt:1}}>
                  正式な実行版：{graph.target.releasedVersion?'v'+graph.target.releasedVersion:graph.target.methodVersion||'不明'}
                </Typography>
                <Typography sx={{fontSize:12,color:V.muted,mt:2}}>
                  旧Skill本文は変更せず、保存済み仮説と本人評価を参照
                </Typography>
              </Box>
              <Box sx={boxStyle}>
                <Typography sx={{fontWeight:800,fontSize:12.5,mb:1}}>部位を選択 →</Typography>
                <Stack gap={0.7}>
                  {modules.map(m=>(
                    <Box key={m.id} component="button" type="button"
                      onClick={()=>{setModuleKey(m.id);setHypothesisKey(null);}}
                      sx={{p:1.2,textAlign:'left',borderRadius:1.5,cursor:'pointer',
                        border:'1px solid',borderColor:selectedModule?.id===m.id?V.blue:V.rule,
                        background:selectedModule?.id===m.id?V.accentSoft:'transparent'}}>
                      <Typography sx={{fontSize:13.2,fontWeight:800}}>{m.name}</Typography>
                      <Typography sx={{fontSize:11.5,color:V.muted}}>{m.hypothesisIds.length}仮説{m.id==='root'?'（未分類を含む）':''}</Typography>
                    </Box>
                  ))}
                </Stack>
              </Box>
              <Box sx={boxStyle}>
                <Typography sx={{fontWeight:800,fontSize:12.5,mb:1}}>検証仮説の系譜 →</Typography>
                {!hypotheses.length&&<Typography sx={{fontSize:12,color:V.muted}}>この部位に対応する仮説はありません。</Typography>}
                <Stack gap={0.8}>
                  {hypotheses.map(h=>(
                    <Box key={h.id} component="button" type="button"
                      onClick={()=>setHypothesisKey(h.id)}
                      sx={{p:1.35,textAlign:'left',borderRadius:1.5,cursor:'pointer',border:'1px solid',
                        borderColor:selectedHypothesis?.id===h.id?'#A884C8':V.rule,
                        background:selectedHypothesis?.id===h.id?'#F4EEFA':'transparent'}}>
                      <Typography sx={{fontSize:13.3,fontWeight:800}}>{h.id} · {h.title}</Typography>
                      <Typography sx={{fontSize:11.5,color:V.muted,mt:0.35}}>
                        {h.polarity==='negative'?'負仮説 · ':''}{PROMOTION_LABEL[h.promotion?.state]||h.promotion?.state}
                      </Typography>
                    </Box>
                  ))}
                </Stack>
                {!!selectedHypothesis&&(
                  <Box sx={{mt:1.6,pt:1.4,borderTop:'1px solid '+V.rule}}>
                    <Typography sx={{fontSize:12.5,fontWeight:800,mb:0.5}}>主張と検証条件</Typography>
                    <Typography sx={{fontSize:12.3,lineHeight:1.75,whiteSpace:'pre-wrap'}}>{selectedHypothesis.statement||'主張未登録'}</Typography>
                    {!!selectedHypothesis.limits&&<Typography sx={{fontSize:12,color:V.muted,mt:0.75}}>限界：{selectedHypothesis.limits}</Typography>}
                    {edges.length>0&&(
                      <Box sx={{mt:1.2}}>
                        <Typography sx={{fontSize:12,fontWeight:800}}>関連する仮説</Typography>
                        {edges.map(e=><Typography key={e.id} sx={{fontSize:11.5,color:V.muted,mt:0.35}}>
                          {e.sourceId} → {e.targetId} · {e.relation}（{e.status==='proposed'?'提案': '旧研究記録'}）
                        </Typography>)}
                      </Box>
                    )}
                  </Box>
                )}
              </Box>
              <Box sx={boxStyle}>
                <Typography sx={{fontWeight:800,fontSize:12.5,mb:1}}>評価物と本人フィードバック</Typography>
                {selectedHypothesis&&(
                  <Box sx={{p:1.2,mb:1.2,borderRadius:1.5,background:'#EAF6F1'}}>
                    <Typography sx={{fontSize:12.5,fontWeight:800}}>{PROMOTION_LABEL[selectedHypothesis.promotion?.state]||'未判定'}</Typography>
                    <Typography sx={{fontSize:12,color:V.muted,mt:0.45}}>
                      {stats?stats.n+'件中 '+stats.pass+'件合格 / '+stats.partial+'件惜しい / '+stats.fail+'件ボツ':'評価なし'}
                      {stats?.passRate!==null&&stats?.passRate!==undefined?' · 合格率 '+percent(stats.passRate):''}
                    </Typography>
                    <Typography sx={{fontSize:11.5,color:V.muted,mt:0.4}}>
                      Skillへの自動採用：無効（{selectedHypothesis.promotion?.eligibleForMerge?'比較候補あり':'検証不足'}）
                    </Typography>
                  </Box>
                )}
                {!trials.length&&<Typography sx={{fontSize:12,color:V.muted}}>紐付いた評価物はまだありません。</Typography>}
                <Stack gap={1}>
                  {trials.slice().reverse().slice(0,30).map(t=>(
                    <Box key={t.id} sx={{p:1.2,border:'1px solid',borderColor:'divider',borderRadius:1.5}}>
                      <Typography sx={{fontSize:12.5,fontWeight:800}}>{t.id} · {t.label}</Typography>
                      <Typography sx={{fontSize:12,color:t.verdict==='pass'?V.green:t.verdict==='fail'?V.pink:V.amber,mt:0.4,fontWeight:700}}>
                        {t.verdict==='pass'?'合格':t.verdict==='fail'?'ボツ':t.verdict==='partial'?'惜しい':'未評価'}
                      </Typography>
                      {!!t.body&&<Typography sx={{fontSize:12,whiteSpace:'pre-wrap',lineHeight:1.6,mt:0.6}}>{t.body.slice(0,420)}</Typography>}
                      {!!t.userWords&&<Typography sx={{fontSize:12,color:V.muted,mt:0.5}}>本人の言葉：{t.userWords}</Typography>}
                      {!!t.imageUrl&&<Link href={t.imageUrl} target="_blank" rel="noreferrer">画像を見る</Link>}
                      {!!t.mediaUrl&&<Link href={t.mediaUrl} target="_blank" rel="noreferrer">評価物を見る</Link>}
                    </Box>
                  ))}
                </Stack>
                {trials.length>30&&<Typography sx={{fontSize:11.5,color:V.muted,mt:1}}>最新30件を表示。全履歴はMCPのfullビューで参照できます。</Typography>}
              </Box>
            </Box>
          </Box>
          <Typography sx={{fontSize:11.5,color:V.muted,mt:1.4}}>
            {graph.migration.historicalHypotheses}仮説・{graph.migration.historicalTrials}Trialを元レコードから読込。
            学習・リリースの既存ゲートは維持。証拠判定は {graph.policyVersion}（参考判定）です。
          </Typography>
        </>
      )}
    </Box>
  );
}

function BaseDetail({ detail, onDecide, busy, onRate, onRateBatch, busyId }) {
  const [tab, setTab] = useState('goal');
  const { base, outcome = {}, method, full = {}, position = {} } = detail;
  const awaiting = outcome.awaitingConfirmation || [];
  const proposals = (full.proposals || []).filter((proposal) => proposal.status === 'pending');
  const hypotheses = full.hypotheses || [];
  const open = hypotheses.filter((item) => item.status === 'open');
  const sources = full.sources || [];
  const constraints = (full.constraints || []).filter((item) => item.status === 'active');
  const runs = full.runs || [];
  const timeline = timelineOf(runs, full.events || []);
  const url = methodUrl(method?.bodyRef);
  const state = {
    status: base.status, loop: detail.loop ? { awaiting: (detail.loop.awaiting || []).length, failStreak: detail.loop.failStreak } : null, awaitingCount: awaiting.length,
    pendingProposalCount: proposals.length, stalledRuns: position.stalledRuns, openRunId: position.openRunId,
    runCount: position.runCount, lastRun: (position.lastRuns || [])[0],
  };

  return (
    <Box>
      <Typography component="h1" sx={{ fontSize: { xs: 22, md: 26 }, fontWeight: 900, letterSpacing: '-0.02em', lineHeight: 1.3 }}>{base.title}</Typography>
      {method?.target && (
        <Typography sx={{ fontSize: 13, color: V.accent, fontWeight: 700, mt: 0.5 }}>
          鍛えている{method.target.kind === 'intelligence_pack' ? 'Pack' : 'スキル'}：{method.target.title || method.target.id}（実行は v{method.target.releasedVersion}）
          {method.target.unreleasedNewer && <span style={{ color: 'var(--p-amber)' }}>　道場を通っていない v{method.target.latestVersion} があります</span>}
        </Typography>
      )}
      <Typography sx={{ fontSize: 14, color: V.muted, mt: 0.6, maxWidth: 760, lineHeight: 1.7 }}>{base.summary}</Typography>

      <Box sx={{ mt: 3, py: 2.2, borderTop: '1px solid ' + V.ink, borderBottom: '1px solid ' + V.rule, display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'minmax(0,1fr) auto' }, gap: 2, alignItems: 'center' }}>
        <Box>
          <Status state={state} size={15} />
          {state.lastRun?.nextStep && <Typography sx={{ fontSize: 13, color: V.muted, mt: 0.6, pl: 2 }}>次の一手：{state.lastRun.nextStep}</Typography>}
        </Box>
        <PassRate big loop={detail.loop ? {
          rated: detail.loop.overall.rated, passRate: detail.loop.overall.passRate,
          currentRated: detail.loop.current.rated, currentPassRate: detail.loop.current.passRate,
        } : null} />
      </Box>

      {detail.loop ? <LoopPanel loop={detail.loop} baseId={base.id} onRate={onRate} onRateBatch={onRateBatch} busyId={busyId} /> : <VersionFeedback feedback={detail.feedback} />}

      {(awaiting.length > 0 || proposals.length > 0) && (
        <>
          <Heading>あなたの判断待ち</Heading>
          {awaiting.map((item) => (
            <Box key={item.id} sx={{ py: 1.3, borderBottom: '1px solid ' + V.rule, display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'minmax(0,1fr) auto' }, gap: 1.2, alignItems: 'center' }}>
              <Box sx={{ minWidth: 0 }}>
                <Typography sx={{ fontSize: 15, fontWeight: 800 }}>{item.label}</Typography>
                <Typography sx={{ fontSize: 13, color: V.muted, mt: 0.3, lineHeight: 1.6 }}>{item.evidence}</Typography>
              </Box>
              <Stack direction="row" gap={1}>
                <Button size="small" variant="contained" disabled={busy} onClick={() => onDecide(item, 'confirmed')}>成果にする</Button>
                <Button size="small" variant="outlined" disabled={busy} onClick={() => onDecide(item, 'declined')}>見送る</Button>
              </Stack>
            </Box>
          ))}
          {proposals.map((proposal) => (
            <Box key={proposal.id} sx={{ py: 1.3, borderBottom: '1px solid ' + V.rule }}>
              <Typography sx={{ fontSize: 14, fontWeight: 800 }}>ゴールの変更提案</Typography>
              <Typography sx={{ fontSize: 13, mt: 0.3, lineHeight: 1.6 }}>{proposal.reason}</Typography>
              {proposal.proposed?.statement && <Typography sx={{ fontSize: 13, color: V.muted, mt: 0.3 }}>提案：{proposal.proposed.statement}</Typography>}
              <Typography sx={{ fontSize: 12, color: V.faint, mt: 0.3 }}>採否はチャットで伝えてください。</Typography>
            </Box>
          ))}
        </>
      )}

      <Tabs value={tab} onChange={(_, value) => setTab(value)} variant="scrollable" allowScrollButtonsMobile
        sx={{ mt: 3, borderBottom: '1px solid ' + V.rule, minHeight: 42, '& .MuiTab-root': { minHeight: 42, fontSize: 13.5, fontWeight: 700 } }}>
        {TABS.map((item) => {
          const count = { guesses: open.length, sources: sources.filter((source) => source.status === 'open').length, constraints: constraints.length }[item.key];
          return <Tab key={item.key} value={item.key} label={item.label + (count !== undefined ? ' ' + count : '')} />;
        })}
      </Tabs>
      <Box sx={{ pt: 2.5 }}>
      {tab === 'goal' && (<>
      <Typography sx={{ fontSize: 15.5, fontWeight: 750, lineHeight: 1.7 }}>{outcome.statement}</Typography>
      {outcome.acceptance && (
        <Typography sx={{ fontSize: 14, lineHeight: 1.85, mt: 1, whiteSpace: 'pre-line' }}>{outcome.acceptance}</Typography>
      )}
      <Box sx={{ mt: 1.5 }}>
        <DetailRow label="その先に見る指標">{outcome.finalIndicator}</DetailRow>
        <DetailRow label="成果に数えないもの">{(outcome.proxies || []).join('、')}</DetailRow>
        <DetailRow label="止める条件">{(outcome.stopConditions || []).map((text) => <Box key={text}>{text}</Box>)}</DetailRow>
        <DetailRow label="期限">{outcome.deadline || 'なし'}</DetailRow>
      </Box>
      </>)}

      {tab === 'graph' && <SkillEvidenceGraph baseId={base.id} />}

      {tab === 'timeline' && (<>
        <Typography sx={{ fontSize: 12.5, color: V.muted, mb: 1 }}>
          探索の回（{runs.length}回）と、ゴール・制約・見立て・スキルの版の変更を、新しい順に並べています。
        </Typography>
        {!runs.length && timeline.length > 0 && <Typography sx={{ fontSize: 12.5, color: V.muted, mb: 1 }}>探索はまだ一度も行っていません。下は道場を整えたときの変更です。</Typography>}
        {timeline.map((entry) => (entry.kind === 'run'
          ? <Run key={entry.key} run={entry.run} hypotheses={hypotheses} />
          : (
            <Box key={entry.key} sx={{ display: 'grid', gridTemplateColumns: '48px minmax(0,1fr)', columnGap: 1.5, py: 0.7, borderBottom: '1px solid ' + V.rule }}>
              <Small>{shortDate(entry.at)}</Small>
              <Typography sx={{ fontSize: 12.5, color: V.muted, lineHeight: 1.6 }}>
                <b style={{ color: 'var(--p-ink)' }}>{EVENT_LABEL[entry.event.type] || entry.event.type}</b>　{entry.event.summary}
              </Typography>
            </Box>
          )))}
        {!timeline.length && <Quiet>まだ記録はありません。</Quiet>}
      </>)}

      {tab === 'guesses' && (
        <Ledger items={hypotheses} stages={STAGE} empty="検討中の見立てはありません。"
          closedLabel="棄却・引退" closedNote="同じ推論を繰り返さないために残している" />
      )}

      {tab === 'sources' && (<>
        <Typography sx={{ fontSize: 12.5, color: V.muted, mb: 0.5 }}>
          候補をどこから拾うか。実際に候補や成果を生んだかで検証度が上がり、空振りが続いたものは外します。
        </Typography>
        <Ledger items={sources} stages={SOURCE_STAGE} empty="情報源はまだ記録されていません。"
          closedLabel="外した・引退" closedNote="同じ所を掘り直さないために残している" />
      </>)}

      {tab === 'constraints' && (<>
      {['user', 'environment', 'agent'].map((owner) => {
        const list = constraints.filter((item) => item.owner === owner);
        if (!list.length) return null;
        return (
          <Box key={owner} sx={{ mt: 1.5 }}>
            <Typography sx={{ fontSize: 12.5, fontWeight: 800, color: V.muted }}>{OWNER[owner]} <Small>{list.length}</Small></Typography>
            {list.map((item) => (
              <Box key={item.id} sx={{ py: 1, borderBottom: '1px solid ' + V.rule }}>
                <Typography sx={{ fontSize: 13.5, lineHeight: 1.65 }}>{item.statement}</Typography>
                {(item.rationale || item.basis) && <Typography sx={{ fontSize: 12, color: V.muted, mt: 0.2 }}>{item.rationale || item.basis}</Typography>}
              </Box>
            ))}
          </Box>
        );
      })}
      {!constraints.length && <Quiet>制約はありません。</Quiet>}
      </>)}

      {tab === 'method' && (<>
      {method && <Typography sx={{ fontSize: 12.5, color: V.muted }}>{method.title}　<b style={{ color: 'var(--p-ink)' }}>{method.version}</b>　{shortDate(method.setAt)}</Typography>}
      {method?.target && (
        <Box sx={{ mt: 1, py: 1, px: 1.5, borderLeft: '3px solid ' + (method.target.unreleasedNewer ? V.amber : V.accent), background: V.accentSoft }}>
          <Typography sx={{ fontSize: 13.5, lineHeight: 1.6 }}>
            鍛えている{method.target.kind === 'intelligence_pack' ? 'Pack' : 'スキル'}：<b>{method.target.title || method.target.id}</b>　実行で使う版 <b>v{method.target.releasedVersion}</b>
          </Typography>
          {method.target.unreleasedNewer && (
            <Typography sx={{ fontSize: 12.5, color: V.muted, mt: 0.3 }}>
              v{method.target.latestVersion} がこの道場の外で作られています。ここで確かめるまで、実行は v{method.target.releasedVersion} のままです。
            </Typography>
          )}
          {method.target.error && <Typography sx={{ fontSize: 12.5, color: V.pink, mt: 0.3 }}>読み込めませんでした：{method.target.error}</Typography>}
        </Box>
      )}
      {method ? (
        method.body ? <MarkdownBody source={method.body} /> : (
          <DetailRow label="本文">
            {url ? <Link href={url} target="_blank" rel="noreferrer" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.4 }}>
              {method.bodyRef?.path || method.bodyRef?.location}<OpenInNew sx={{ fontSize: 14 }} />
            </Link> : method.bodyRef?.location}
          </DetailRow>
        )
      ) : <Quiet>鍛えるスキルはまだ設定されていません。</Quiet>}
      </>)}

      </Box>
    </Box>
  );
}

// ---- List -------------------------------------------------------------------

// Live evidence radar: observations are never substituted with AI predictions.
// Derived from the same cached dojo/loop records that the list renders.
function DojoEvidenceRadar({ items, awaiting, onOpen }) {
  const [expanded, setExpanded] = useState(false);
  const waitingIds = new Map();
  (awaiting || []).forEach(item => waitingIds.set(item.baseId, (waitingIds.get(item.baseId) || 0) + 1));
  const rows = (items || []).map(item => {
    const loop = item.loop || {};
    const rated = loop.currentRated || 0;
    const waiting = waitingIds.get(item.id) || 0;
    const historical = loop.rated || 0;
    const prior = loop.previousPassRate;
    const current = loop.currentPassRate;
    const lower = rated >= 3 && Number.isFinite(prior)
      && Number.isFinite(current) && current < prior;
    const status = waiting > 0 ? '本人評価待ち' :
      lower ? '前版より低下（要比較）' :
      rated === 0 ? (historical > 0 ? '新版は未評価' : '成果・評価の観測なし') :
      rated < 3 ? '現行版は少数評価' : '現行版の評価あり';
    const priority = waiting ? 0 : lower ? 1 : rated === 0 ? 2 : rated < 3 ? 3 : 4;
    return { id:item.id, title:item.title, status, priority, waiting,
      currentRate:rated?current:null, currentRated:rated, historical,
      priorRate:prior, target:item.target };
  }).sort((a,b)=>a.priority-b.priority || a.currentRated-b.currentRated || a.title.localeCompare(b.title,'ja'));
  const waitingCount=rows.filter(row=>row.waiting).length;
  const unmeasured=rows.filter(row=>row.currentRated===0).length;
  const down=rows.filter(row=>row.priority===1).length;
  return (
    <Box sx={{borderTop:'1px solid '+V.rule,borderBottom:'1px solid '+V.rule,py:2,my:2}}>
      <Stack direction="row" justifyContent="space-between" alignItems="center" gap={1}>
        <Box>
          <Typography sx={{fontWeight:850,fontSize:15.5}}>全道場の品質検証状況</Typography>
          <Typography sx={{fontSize:12.5,color:V.muted}}>
            {rows.length}道場 · 本人評価待ち {waitingCount}道場 · 現行版0件 {unmeasured}道場 · 前版との低下 {down}道場
          </Typography>
        </Box>
        <Button size="small" variant="text" onClick={()=>setExpanded(x=>!x)}>
          {expanded?'閉じる':'全件を確認'}
        </Button>
      </Stack>
      <Typography sx={{fontSize:11.5,color:V.faint,mt:0.6}}>
        表示は版別の本人採否だけです。サーバー実行・素材取得・AI自己判定・過去版の合格は現行版の成果に加算しません。
      </Typography>
      <Collapse in={expanded}>
        <Box sx={{mt:1.2}}>
          {rows.map(row=>(
            <Box key={row.id} component="button" type="button" onClick={()=>onOpen(row.id)}
              sx={{all:'unset',width:'100%',cursor:'pointer',display:'flex',
                justifyContent:'space-between',gap:1.5,py:1.2,borderBottom:'1px solid '+V.rule,
                '&:hover':{background:V.accentSoft}}}>
              <Box sx={{minWidth:0}}>
                <Typography sx={{fontSize:13.5,fontWeight:700}}>{row.title}</Typography>
                <Typography sx={{fontSize:12,color:V.muted}}>{row.status}
                  {row.waiting>0?'（'+row.waiting+'件）':''}
                </Typography>
              </Box>
              <Typography sx={{fontSize:12.5,color:V.muted,textAlign:'right',whiteSpace:'nowrap'}}>
                {row.currentRated ? percent(row.currentRate)+' / '+row.currentRated+'件':'現行版未評価'}
              </Typography>
            </Box>
          ))}
        </Box>
      </Collapse>
    </Box>
  );
}

function BaseList({ items, onOpen }) {
  if (!items.length) return <Quiet>まだ道場はありません。</Quiet>;
  return (
    <Box sx={{ borderTop: '1px solid ' + V.ink }}>
      {items.map((base) => (
        <Box key={base.id} component="button" type="button" onClick={() => onOpen(base.id)}
          sx={{
            all: 'unset', boxSizing: 'border-box', width: '100%', cursor: 'pointer', display: 'grid',
            gridTemplateColumns: { xs: '1fr', md: 'minmax(0,1fr) 120px' }, columnGap: 3, rowGap: 1,
            py: 2.2, px: 1, borderBottom: '1px solid ' + V.rule, alignItems: 'center',
            '&:hover': { background: V.accentSoft }, '&:focus-visible': { outline: '2px solid ' + V.accent },
          }}>
          <Box sx={{ minWidth: 0 }}>
            <Typography sx={{ fontSize: 17, fontWeight: 850 }}>{base.title}</Typography>
            {base.target && <Typography sx={{ fontSize: 12.5, color: V.accent, mt: 0.3, fontWeight: 700 }}>
              {base.target.kind === 'intelligence_pack' ? 'Pack' : 'スキル'} {base.target.id}　v{base.target.versionNumber}
            </Typography>}
            <Typography sx={{ fontSize: 13.5, color: V.muted, mt: 0.3, lineHeight: 1.6 }}>{base.outcome?.statement}</Typography>
            <Box sx={{ mt: 0.8 }}><Status state={base} size={13} /></Box>
          </Box>
          <PassRate loop={base.loop} />
        </Box>
      ))}
    </Box>
  );
}

function DojoDependencyPanel() {
  const [expanded, setExpanded] = useState(false);
  const [graph, setGraph] = useState(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  const load = async () => {
    setExpanded(true);
    setBusy(true);
    setProblem('');
    try {
      setGraph(await api('?resource=dojo_dependency_audit'));
    } catch (error) { setProblem(error.message || '依存関係を取得できません'); }
    finally { setBusy(false); }
  };
  const packs = (graph?.nodes || []).filter((node) => node.type === 'intelligence_pack');
  const links = graph?.edges || [];
  const problems = (graph?.warnings || []).filter((item) =>
    ['missing_skill', 'pack_not_selectable', 'release_conflict_or_missing', 'unreleased_pack_candidate'].includes(item.type));
  return (
    <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2, p: 2, mb: 2 }}>
      <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" gap={1}>
        <Box>
          <Typography sx={{ fontWeight: 800, fontSize: 15 }}>道場・共有Skill・Pack の依存関係</Typography>
          <Typography sx={{ fontSize: 12, color: V.muted, mt: 0.5 }}>現在の実行版を取得。旧版ピンは履歴として分離して表示します。</Typography>
          <Link href="https://github.com/nomuonji/my-portal/issues/167" target="_blank" rel="noopener noreferrer" sx={{ display: 'inline-block', mt: 0.75, fontSize: 13 }}>全修正の進捗チェックリスト（GitHub #167）</Link>
        </Box>
        <Button size="small" variant="outlined" onClick={load} disabled={busy} sx={{ alignSelf: 'flex-start' }}>
          {busy ? '照合中…' : expanded ? '再照合' : '依存関係を表示'}
        </Button>
      </Stack>
      <Collapse in={expanded}>
        {problem && <Alert severity="warning" sx={{ mt: 2 }}>{problem}</Alert>}
        {busy && <CircularProgress size={18} sx={{ mt: 2 }} />}
        {graph && (
          <Box sx={{ mt: 2 }}>
            <Typography sx={{ fontSize: 12.5, color: V.muted, mb: 1 }}>
              {graph.summary?.activeDojos}道場 / {graph.summary?.activePacks} Pack / {graph.summary?.availableSkills} Skill / {graph.summary?.activeSubmarines ?? 0}潜水艦。
              Pack参照Skill {graph.summary?.uniqueSkillsInPacks}件、旧版の記録 {graph.summary?.historicalSkillPins}箇所。
            </Typography>
            <Stack gap={1.5}>
              {packs.map((pack) => {
                const deps = links.filter((edge) => edge.type === 'uses_skill' && edge.from === 'intelligence_pack:' + pack.id);
                const trainers = links.filter((edge) => edge.type === 'trains' && edge.to === 'intelligence_pack:' + pack.id);
                return (
                  <Box key={pack.id} sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1.5, p: 1.5 }}>
                    <Typography sx={{ fontSize: 13.5, fontWeight: 800, overflowWrap: 'anywhere' }}>
                      {pack.id} · 実行版 v{pack.executableVersion}
                      {pack.registryVersion !== pack.executableVersion ? ' / 未承認候補 v' + pack.registryVersion : ''}
                    </Typography>
                    <Typography sx={{ fontSize: 12, color: V.muted, mb: 0.5 }}>
                      {trainers.length ? '錬成: ' + trainers.map((edge) => edge.from.replace('dojo:', '')).join(', ') : 'Pack専用道場なし'}
                      {!pack.inAgentProfile ? ' · Profile未接続' : ''}
                    </Typography>
                    {deps.map((dep, i) => (
                      <Typography key={dep.to + ':' + (dep.componentId || '') + ':' + i}
                        sx={{ fontSize: 12, color: V.muted, lineHeight: 1.7, overflowWrap: 'anywhere' }}>
                        {dep.componentId ? dep.componentId + ' / ' : ''}{dep.to.replace('chat_skill:', '')}
                        {' · '}{dep.autoLoad ? '自動読込' : '選択時のみ'}{' · 実行 v'}{dep.resolvedVersion ?? '不明'}
                        {dep.declaredVersion && dep.declaredVersion !== dep.resolvedVersion ? ' (履歴 v' + dep.declaredVersion + ')' : ''}
                      </Typography>
                    ))}
                  </Box>
                );
              })}
            </Stack>
            {(graph.nodes || []).filter((node) => node.type === 'submarine').length > 0 && (
              <Box sx={{ mt: 1.5 }}>
                <Typography sx={{ fontSize: 13, fontWeight: 800, mb: 0.7 }}>潜水艦の装備</Typography>
                {(graph.nodes || []).filter((node) => node.type === 'submarine').map((boat) => {
                  const gear = links.filter((edge) => edge.type === 'carries' && edge.from === 'submarine:' + boat.id);
                  return (
                    <Typography key={boat.id} sx={{ fontSize: 12, color: V.muted, lineHeight: 1.8 }}>
                      {boat.title}: {gear.map((edge) => edge.to.replace(/^(chat_skill|intelligence_pack):/, '') +
                        ' v' + (edge.resolvedVersion ?? '?')).join(' / ') || '装備なし'}
                    </Typography>
                  );
                })}
              </Box>
            )}
            {links.some((edge) => edge.type === 'skill_uses_skill') && (
              <Box sx={{ mt: 1.5 }}>
                <Typography sx={{ fontSize: 13, fontWeight: 800, mb: 0.7 }}>Skill同士の依存（用途条件付き）</Typography>
                {links.filter((edge) => edge.type === 'skill_uses_skill').map((edge) => (
                  <Typography key={edge.from + edge.to} sx={{ fontSize: 12, color: V.muted, lineHeight: 1.7 }}>
                    {edge.from.replace('chat_skill:', '')} → {edge.to.replace('chat_skill:', '')}
                    {' · '}{edge.autoLoadByDefault ? '標準用途で自動読込' : '必要な用途のときのみ'}
                    {' · 最新 v'}{edge.resolvedVersion ?? '?'} / {edge.when?.join(', ')}
                  </Typography>
                ))}
                <Typography sx={{ fontSize: 11.5, color: V.muted, mt: 0.5 }}>
                  造形の技術修正やシリアスな制作にユーモアを強制しません。参照はIDのみで、実行時に最新の承認版を読みます。
                </Typography>
              </Box>
            )}
            {problems.length > 0 && (
              <Alert severity="warning" sx={{ mt: 1.5 }}>
                {problems.length}件の依存要確認: {problems.slice(0, 4).map((item) => item.packId || item.resource || item.skillId).join('、')}
              </Alert>
            )}
            <Typography sx={{ fontSize: 11.5, color: V.muted, mt: 1 }}>
              本人の合格・ボツは他道場へ自動転記されません。Packへの未参照Skillは単独利用の可能性があります。
            </Typography>
          </Box>
        )}
      </Collapse>
    </Box>
  );
}

function DojoPeerLearningPanel({ baseId }) {
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const load = async () => {
    setBusy(true);
    setError('');
    try { setData(await api('?resource=dojo_cross_learning&id=' + encodeURIComponent(baseId))); }
    catch (err) { setError(err.message || '他道場の記録を取得できません'); }
    finally { setBusy(false); }
  };
  useEffect(() => { setData(null); setError(''); }, [baseId]);
  return (
    <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2, p: 2, mt: 2 }}>
      <Stack direction="row" justifyContent="space-between" alignItems="center" gap={1}>
        <Box>
          <Typography sx={{ fontSize: 14, fontWeight: 800 }}>他道場からの学び</Typography>
          <Typography sx={{ fontSize: 12, color: V.muted }}>共有Skillと専門Packを根拠に、本人評価済みの正例・反例を探索します。転用効果は未検証です。</Typography>
        </Box>
        <Button size="small" onClick={load} disabled={busy}>{busy ? '取得中…' : '照合'}</Button>
      </Stack>
      {error && <Alert severity="warning" sx={{ mt: 1 }}>{error}</Alert>}
      {data && (
        <Stack gap={1} sx={{ mt: 1.5 }}>
          {!data.sources?.length && <Typography sx={{ fontSize: 12, color: V.muted }}>確認できた構造的な接続がありません。無関係な採用例を流用しません。</Typography>}
          {(data.sources || []).map((source) => (
            <Box key={source.sourceBaseId} sx={{ bgcolor: 'action.hover', borderRadius: 1.5, p: 1.5 }}>
              <Typography sx={{ fontWeight: 800, fontSize: 12.5 }}>{source.sourceTitle}</Typography>
              <Typography sx={{ color: V.muted, fontSize: 11.5 }}>接続根拠: {source.connectionReasons.join(', ')}</Typography>
              <Typography sx={{ fontSize: 12, mt: 0.6 }}>
                合格例: {source.accepted?.map((item) => item.trialId + ' ' + item.label).join(' / ') || 'なし'}
              </Typography>
              <Typography sx={{ fontSize: 12 }}>
                不採用例: {source.rejected?.map((item) => item.trialId + ' ' + item.label).join(' / ') || 'なし'}
              </Typography>
            </Box>
          ))}
          <Typography sx={{ fontSize: 11.5, color: V.muted }}>採用された機序を仮説として検証するための参照です。受け側の本人合格には算入しません。</Typography>
        </Stack>
      )}
    </Box>
  );
}

export default function ExplorationBases() {
  const [params, setParams] = useSearchParams();
  const selectedId = params.get('id') || '';
  const [items, setItems] = useState([]);
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [decision, setDecision] = useState(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [awaiting, setAwaiting] = useState([]);
  const [ratingKey, setRatingKey] = useState('');

  const loadList = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [data, waiting] = await Promise.all([
        api('?resource=exploration_bases'),
        api('?resource=exploration_awaiting_trials').catch(() => ({ items: [] })),
      ]);
      setItems(Array.isArray(data.items) ? data.items : []);
      setAwaiting(Array.isArray(waiting.items) ? waiting.items : []);
    } catch (err) {
      setError('道場を読み込めません: ' + err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadDetail = useCallback(async (id) => {
    if (!id) { setDetail(null); return; }
    setDetailLoading(true);
    setError('');
    try {
      setDetail(await api('?resource=exploration_base&eventLimit=60&id=' + encodeURIComponent(id)));
    } catch (err) {
      setDetail(null);
      setError('道場を読み込めません: ' + err.message);
    } finally {
      setDetailLoading(false);
    }
  }, []);

  useEffect(() => { loadList(); }, [loadList]);
  useEffect(() => { loadDetail(selectedId); }, [loadDetail, selectedId]);

  const open = (id) => setParams(id ? { id } : {});

  const rate = async (trial, verdict, comment) => {
    const key = trial.baseId + ':' + trial.id;
    setRatingKey(key);
    setError('');
    try {
      await api('', { action: 'exploration_trial_rate', baseId: trial.baseId, id: trial.id, verdict, comment });
      setNotice(trial.label + ' を「' + VERDICT_LABEL[verdict] + '」で記録しました');
      setAwaiting((all) => all.filter((t) => t.baseId + ':' + t.id !== key));
      await Promise.all([selectedId ? loadDetail(selectedId) : null, loadList()]);
    } catch (err) {
      setError(err.message || '保存に失敗しました');
    } finally {
      setRatingKey('');
    }
  };

  // One transaction per 道場; on the all-dojos screen, save each base separately and
  // report partial failures rather than resending already successful ratings.
  const rateBatch = async (rows) => {
    if (!rows.length) return [];
    setRatingKey('batch');
    setError('');
    const groups = new Map();
    rows.forEach(({ baseId, id, verdict, comment, key }) => {
      if (!groups.has(baseId)) groups.set(baseId, []);
      groups.get(baseId).push({ id, verdict, comment, key });
    });
    const savedKeys = [];
    const failures = [];
    try {
      for (const [baseId, group] of groups) {
        try {
          await api('', { action: 'exploration_trial_rate', baseId,
            ratings: group.map(({ id, verdict, comment }) => ({ id, verdict, comment })) });
          savedKeys.push(...group.map(({ key }) => key));
        } catch (err) {
          failures.push(baseId + '：' + (err.message || '保存に失敗'));
        }
      }
      if (savedKeys.length) setNotice(savedKeys.length + '件の評価をまとめて保存しました');
      if (failures.length) setError('保存できなかった道場があります。未保存の選択だけ残しています。' + failures.join(' / '));
      await Promise.all([loadList(), selectedId ? loadDetail(selectedId) : Promise.resolve()]);
      return savedKeys;
    } finally {
      setRatingKey('');
    }
  };

  const decide = async () => {
    if (!decision) return;
    setBusy(true);
    setError('');
    try {
      await api('', {
        action: 'exploration_achievement_decide', baseId: selectedId,
        id: decision.item.id, decision: decision.value, note: note.trim(),
      });
      setNotice(decision.item.label + ' を' + (decision.value === 'confirmed' ? '成果にしました' : '見送りました'));
      setDecision(null);
      setNote('');
      await Promise.all([loadDetail(selectedId), loadList()]);
    } catch (err) {
      setError(err.message || '保存に失敗しました');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Box sx={{ maxWidth: 880, mx: 'auto', pb: 8 }}>
      <Stack direction="row" justifyContent="space-between" alignItems="center" gap={1} sx={{ mb: selectedId ? 2 : 0 }}>
        {selectedId ? (
          <Button startIcon={<ArrowBack />} onClick={() => open('')} sx={{ px: 0, color: V.muted }}>道場の一覧</Button>
        ) : (
          <Box>
            <Typography component="h1" sx={{ fontSize: { xs: 24, md: 28 }, fontWeight: 900, letterSpacing: '-0.03em' }}>スキル錬成道場</Typography>
            <Typography sx={{ fontSize: 13.5, color: V.muted, mt: 0.4, lineHeight: 1.65 }}>
              スキルごとの道場です。実行（定期ジョブなど）は、ここで合格させた版のスキルを使います。結果を見て見立てや情報源を検証し、効いたものだけを次の版に入れます。
            </Typography>
          </Box>
        )}
        <Button size="small" startIcon={<Refresh />} disabled={loading || detailLoading} sx={{ color: V.muted, flexShrink: 0 }}
          onClick={() => { loadList(); loadDetail(selectedId); }}>再読み込み</Button>
      </Stack>

      {error && <Alert severity="error" onClose={() => setError('')} sx={{ mt: 2 }}>{error}</Alert>}
      {notice && <Alert severity="success" onClose={() => setNotice('')} sx={{ mt: 2 }}>{notice}</Alert>}
      {!selectedId && <DojoDependencyPanel />}

      <Box sx={{ mt: selectedId ? 0 : 3 }}>
        {loading && !items.length && !selectedId ? (
          <Box sx={{ display: 'grid', placeItems: 'center', py: 7 }}><CircularProgress /></Box>
        ) : !selectedId ? (
          <>
            {awaiting.length > 0 && (
              <Box sx={{ mb: 3 }}>
                <Heading aside={<Small>見本を読んで押すだけで、その版の合格率と仮説に入ります</Small>}>評価待ちの見本 {awaiting.length}件</Heading>
                <RateTrials items={awaiting} onRate={rate} onRateBatch={rateBatch} busyId={ratingKey} showBase />
              </Box>
            )}
            <DojoEvidenceRadar items={items} awaiting={awaiting} onOpen={open} />
            <BaseList items={items} onOpen={open} />
          </>
        ) : detailLoading && !detail ? (
          <Box sx={{ display: 'grid', placeItems: 'center', py: 7 }}><CircularProgress /></Box>
        ) : detail ? (
          <>
            <BaseDetail detail={detail} busy={busy} onRate={rate} onRateBatch={rateBatch} busyId={ratingKey} onDecide={(item, value) => { setDecision({ item, value }); setNote(''); }} />
            <DojoPeerLearningPanel baseId={selectedId} />
          </>
        ) : null}
      </Box>

      <Dialog open={Boolean(decision)} onClose={() => !busy && setDecision(null)} fullWidth maxWidth="sm">
        <DialogTitle>{decision?.value === 'confirmed' ? '成果にする' : '見送る'}</DialogTitle>
        <DialogContent dividers>
          <Typography sx={{ fontWeight: 800 }}>{decision?.item.label}</Typography>
          <Typography sx={{ fontSize: 13.5, color: V.muted, mt: 0.5, mb: 2, lineHeight: 1.65 }}>
            {decision?.value === 'confirmed'
              ? '成果の件数に数えます。エージェントは次の探索からこれを前提にします。'
              : '成果には数えません。記録は残ります。'}
          </Typography>
          <TextField fullWidth size="small" label="メモ（任意）" value={note} onChange={(event) => setNote(event.target.value)}
            multiline minRows={2} inputProps={{ maxLength: 500 }}
            helperText={decision?.value === 'declined' ? '理由があると、エージェントが次の探索で同じ方向を避けられます。' : ''} />
        </DialogContent>
        <DialogActions sx={{ px: 2, py: 1.5 }}>
          <Button onClick={() => setDecision(null)} disabled={busy}>キャンセル</Button>
          <Button variant="contained" onClick={decide} disabled={busy}>
            {busy ? '保存中…' : decision?.value === 'confirmed' ? '成果にする' : '見送る'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
