import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Alert, Box, Button, CircularProgress, Collapse, Dialog, DialogActions, DialogContent, DialogTitle,
  Link, Stack, TextField, Typography,
} from '@mui/material';
import { ExpandLess, ExpandMore, OpenInNew, Refresh } from '@mui/icons-material';
import { auth } from '../firebase';
import { toText } from './jobOpportunityView';

// 探索拠点: read-only view of the fixed points an agent carries while exploring
// (outcome contract, method version, hypothesis ledger, constraints, runs).
// The only write is the user's own decision on candidate achievements.

const V = {
  surface: 'var(--p-surface)', sunken: 'var(--p-sunken)', ink: 'var(--p-ink)', muted: 'var(--p-muted)',
  faint: 'var(--p-faint)', rule: 'var(--p-rule)', ruleStrong: 'var(--p-rule-strong)', accent: 'var(--p-accent)',
  accentSoft: 'var(--p-accent-soft)', amber: 'var(--p-amber)', blue: 'var(--p-blue)', green: 'var(--p-green)',
  pink: 'var(--p-pink)', teal: 'var(--p-teal)',
};
const MONO = '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace';

const STAGES = [
  { key: 'yielded_outcome', label: '成果を生んだ', color: V.green, note: '確定した成果につながった。勝ちパターン。' },
  { key: 'yielded_candidate', label: '候補を生んだ', color: V.green, note: '合格条件を満たす候補を生んだ。勝ちパターン。' },
  { key: 'reproduced', label: '再現', color: V.blue, note: '別の対象でも同じ現象が出た。' },
  { key: 'observed', label: '観測', color: V.amber, note: '一度は観測した。' },
  { key: 'conjecture', label: '推測', color: V.faint, note: 'まだ観測していない。' },
];
const STAGE_BY_KEY = Object.fromEntries(STAGES.map((stage) => [stage.key, stage]));
const OWNERS = [
  { key: 'user', label: '本人が決めた制約', note: '変えるには本人の承認が要る。' },
  { key: 'environment', label: '測定環境の制約', note: '道具やデータの限界。' },
  { key: 'agent', label: 'エージェントの暫定ルール', note: '探索の規律。結果次第で外す。' },
];
const RUN_STATUS = { open: '実行中', finished: '完了', abandoned: '中断' };
const VERDICT = { supported: '支持', contradicted: '反証', inconclusive: '判定不能' };
const VERDICT_COLOR = { supported: V.green, contradicted: V.pink, inconclusive: V.faint };
const EVIDENCE_TYPE = { observation: '観測', candidate: '候補', outcome: '成果' };
const EVENT_LABEL = {
  base_created: '拠点を作成', outcome_set: '成果条件を変更', outcome_proposed: '成果条件の変更を提案',
  method_version_set: '探索法の版を更新', hypothesis_created: '仮説を追加', hypothesis_updated: '仮説を更新',
  constraint_created: '制約を追加', constraint_updated: '制約を更新', run_started: 'runを開始',
  run_finished: 'runを完了', run_stalled: 'runが空振り', run_abandoned: 'runを中断',
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

function formatDate(value, withTime = false) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit',
    ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}),
  }).format(date);
}

function targetText(target) {
  if (!target) return '—';
  if (target.max && target.max !== target.min) return target.min + '〜' + target.max;
  return String(target.min);
}

function methodUrl(bodyRef) {
  if (!bodyRef) return '';
  const location = String(bodyRef.location || '').replace(/^github:/, '').trim();
  if (/^https?:\/\//.test(location)) return location;
  if (bodyRef.kind === 'repo' && /^[\w.-]+\/[\w.-]+$/.test(location)) {
    const ref = bodyRef.commit || 'main';
    return 'https://github.com/' + location + (bodyRef.path ? '/blob/' + ref + '/' + bodyRef.path : '');
  }
  return '';
}

function MaybeLink({ text }) {
  const value = toText(text);
  if (/^https?:\/\/\S+$/.test(value)) {
    return <Link href={value} target="_blank" rel="noreferrer" sx={{ overflowWrap: 'anywhere' }}>{value}</Link>;
  }
  return <>{value}</>;
}

function Dot({ color, size = 8 }) {
  return <Box component="span" aria-hidden sx={{ display: 'inline-block', width: size, height: size, borderRadius: '50%', background: color, flexShrink: 0 }} />;
}

function Mono({ children, color = V.muted, size = 12 }) {
  return <Typography component="span" sx={{ fontFamily: MONO, fontSize: size, color, letterSpacing: 0 }}>{children}</Typography>;
}

function Section({ index, title, count, subtitle, children }) {
  return (
    <Box component="section" sx={{ mt: { xs: 4, md: 5 } }}>
      <Box sx={{ pb: 1.1, borderBottom: '1px solid ' + V.ink }}>
        <Typography variant="overline" sx={{ color: V.faint, display: 'block' }}>{index}</Typography>
        <Stack direction="row" alignItems="baseline" gap={1}>
          <Typography component="h2" sx={{ fontSize: 18, fontWeight: 800, lineHeight: 1.3 }}>{title}</Typography>
          {count !== undefined && <Mono>{count}</Mono>}
        </Stack>
        {subtitle && <Typography sx={{ fontSize: 12.5, color: V.muted, mt: 0.3, maxWidth: 760 }}>{subtitle}</Typography>}
      </Box>
      {children}
    </Box>
  );
}

function Field({ label, children }) {
  if (children === null || children === undefined || children === '' || (Array.isArray(children) && !children.length)) return null;
  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '140px minmax(0,1fr)' }, columnGap: 2, rowGap: 0.3, py: 1.1, borderBottom: '1px solid ' + V.rule }}>
      <Typography sx={{ fontSize: 12.5, color: V.muted, fontWeight: 700 }}>{label}</Typography>
      <Box sx={{ fontSize: 14, lineHeight: 1.65, minWidth: 0, overflowWrap: 'anywhere' }}>{children}</Box>
    </Box>
  );
}

function Empty({ children }) {
  return <Typography sx={{ py: 2, fontSize: 13.5, color: V.faint }}>{children}</Typography>;
}

function warningsOf(detail) {
  const warnings = [];
  const position = detail.position || {};
  const outcome = detail.outcome || {};
  if ((position.stalledRuns || 0) >= 3) {
    warnings.push(position.stalledRuns + '回続けて、どの定点も動いていません。測定を続ける前に、制約が両立するか・探索法が成果を測れているか・成果条件が今も正しいかを見直す段階です。');
  }
  if (outcome.budget?.maxRuns && (position.runCount || 0) >= outcome.budget.maxRuns && !outcome.reached) {
    warnings.push('run の上限（' + outcome.budget.maxRuns + '回）に達しましたが、成果条件に届いていません。');
  }
  if (position.openRunId) warnings.push('run ' + position.openRunId + ' が実行中のまま残っています。');
  return warnings;
}

function Hypothesis({ item }) {
  const [open, setOpen] = useState(false);
  const stage = STAGE_BY_KEY[item.stage] || { label: item.stage, color: V.faint };
  const closed = item.status !== 'open';
  const color = item.status === 'rejected' ? V.pink : closed ? V.faint : stage.color;
  const evidence = item.evidence || [];
  const counter = item.counterexamples || [];
  return (
    <Box component="article" sx={{ py: 1.6, borderBottom: '1px solid ' + V.rule, opacity: closed ? 0.78 : 1 }}>
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '150px minmax(0,1fr)' }, columnGap: 3, rowGap: 0.6 }}>
        <Stack direction={{ xs: 'row', md: 'column' }} gap={{ xs: 1.2, md: 0.4 }} alignItems={{ xs: 'center', md: 'flex-start' }}>
          <Mono color={V.ink} size={12.5}>{item.id}</Mono>
          <Stack direction="row" gap={0.7} alignItems="center">
            <Dot color={color} />
            <Typography sx={{ fontSize: 12.5, fontWeight: 700, color }}>
              {item.status === 'rejected' ? '棄却' : item.status === 'retired' ? '引退（' + stage.label + '）' : stage.label}
            </Typography>
          </Stack>
          {(evidence.length > 0 || counter.length > 0) && (
            <Mono size={11.5}>根拠 {evidence.length} · 反例 {counter.length}</Mono>
          )}
        </Stack>
        <Box sx={{ minWidth: 0 }}>
          <Typography sx={{ fontSize: 15, fontWeight: 800, lineHeight: 1.45 }}>{item.title}</Typography>
          {item.statement && <Typography sx={{ fontSize: 14, mt: 0.4, lineHeight: 1.7 }}>{item.statement}</Typography>}
          {closed && item.statusReason && (
            <Typography sx={{ fontSize: 13, mt: 0.6, color: V.muted, lineHeight: 1.65 }}>
              <b>{item.status === 'rejected' ? '棄却の理由' : '引退の理由'}：</b>{item.statusReason}
            </Typography>
          )}
          {!closed && item.limits && (
            <Typography sx={{ fontSize: 13, mt: 0.6, color: V.muted, lineHeight: 1.65 }}><b>限界：</b>{item.limits}</Typography>
          )}
          {(item.mechanism || evidence.length > 0 || counter.length > 0 || (item.legacyIds || []).length > 0) && (
            <Button size="small" onClick={() => setOpen((value) => !value)} endIcon={open ? <ExpandLess /> : <ExpandMore />}
              sx={{ mt: 0.4, px: 0, fontSize: 12, color: V.muted, minWidth: 0 }}>
              {open ? '閉じる' : '仕組み・根拠を見る'}
            </Button>
          )}
          <Collapse in={open} unmountOnExit>
            <Box sx={{ mt: 0.6, pl: 1.5, borderLeft: '2px solid ' + V.rule }}>
              {item.mechanism && <Typography sx={{ fontSize: 13, lineHeight: 1.65, mb: 1 }}><b>仕組み：</b>{item.mechanism}</Typography>}
              {evidence.map((entry, index) => (
                <Box key={'e' + index} sx={{ mb: 0.9 }}>
                  <Mono size={11.5}>{(EVIDENCE_TYPE[entry.type] || entry.type) + ' · ' + (entry.date || '') + (entry.runId ? ' · ' + entry.runId : '')}</Mono>
                  <Typography sx={{ fontSize: 13, lineHeight: 1.6 }}>{toText(entry.ref)}</Typography>
                  {entry.source && <Typography sx={{ fontSize: 12, color: V.muted }}><MaybeLink text={entry.source} /></Typography>}
                </Box>
              ))}
              {counter.map((entry, index) => (
                <Box key={'c' + index} sx={{ mb: 0.9 }}>
                  <Mono size={11.5} color={V.pink}>{'反例 · ' + (entry.date || '') + (entry.runId ? ' · ' + entry.runId : '')}</Mono>
                  <Typography sx={{ fontSize: 13, lineHeight: 1.6 }}>{toText(entry.ref || entry)}</Typography>
                  {entry.source && <Typography sx={{ fontSize: 12, color: V.muted }}><MaybeLink text={entry.source} /></Typography>}
                </Box>
              ))}
              {(item.legacyIds || []).length > 0 && <Mono size={11.5}>旧ID: {item.legacyIds.join(', ')}</Mono>}
            </Box>
          </Collapse>
        </Box>
      </Box>
    </Box>
  );
}

function Run({ run }) {
  const [open, setOpen] = useState(false);
  const stalled = run.status === 'finished' && run.moved === false;
  const color = run.status === 'open' ? V.accent : stalled ? V.pink : run.status === 'abandoned' ? V.faint : V.green;
  return (
    <Box component="article" sx={{ py: 1.5, borderBottom: '1px solid ' + V.rule }}>
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '150px minmax(0,1fr)' }, columnGap: 3, rowGap: 0.6 }}>
        <Stack direction={{ xs: 'row', md: 'column' }} gap={{ xs: 1.2, md: 0.4 }} alignItems={{ xs: 'center', md: 'flex-start' }}>
          <Mono color={V.ink} size={12.5}>{run.id}</Mono>
          <Stack direction="row" gap={0.7} alignItems="center">
            <Dot color={color} />
            <Typography sx={{ fontSize: 12.5, fontWeight: 700, color }}>{stalled ? '空振り' : RUN_STATUS[run.status] || run.status}</Typography>
          </Stack>
          <Mono size={11.5}>{formatDate(run.startedAt, true)}</Mono>
          {run.methodVersion && <Mono size={11.5}>{run.methodVersion}</Mono>}
        </Stack>
        <Box sx={{ minWidth: 0 }}>
          <Typography sx={{ fontSize: 14.5, fontWeight: 750, lineHeight: 1.5 }}>{run.objective}</Typography>
          {run.summary && <Typography sx={{ fontSize: 13.5, mt: 0.4, lineHeight: 1.7, color: V.muted }}>{run.summary}</Typography>}
          {(run.verdicts || []).length > 0 && (
            <Stack direction="row" gap={1.2} flexWrap="wrap" sx={{ mt: 0.6 }}>
              {run.verdicts.map((verdict) => (
                <Stack key={verdict.hypothesisId} direction="row" gap={0.5} alignItems="center">
                  <Dot color={VERDICT_COLOR[verdict.result] || V.faint} size={7} />
                  <Mono color={V.ink}>{verdict.hypothesisId}</Mono>
                  <Typography sx={{ fontSize: 12.5, color: VERDICT_COLOR[verdict.result] || V.muted, fontWeight: 700 }}>{VERDICT[verdict.result] || verdict.result}</Typography>
                </Stack>
              ))}
            </Stack>
          )}
          <Button size="small" onClick={() => setOpen((value) => !value)} endIcon={open ? <ExpandLess /> : <ExpandMore />}
            sx={{ mt: 0.4, px: 0, fontSize: 12, color: V.muted, minWidth: 0 }}>
            {open ? '閉じる' : '予測と結果を見る'}
          </Button>
          <Collapse in={open} unmountOnExit>
            <Box sx={{ mt: 0.6, pl: 1.5, borderLeft: '2px solid ' + V.rule }}>
              {run.unknownTerritoryProbe && <Typography sx={{ fontSize: 13, lineHeight: 1.65, mb: 1 }}><b>未踏領域の観測：</b>{run.unknownTerritoryProbe}</Typography>}
              {(run.targets || []).map((target) => {
                const verdict = (run.verdicts || []).find((entry) => entry.hypothesisId === target.hypothesisId);
                return (
                  <Box key={target.hypothesisId} sx={{ mb: 1 }}>
                    <Mono color={V.ink}>{target.hypothesisId}</Mono>
                    <Typography sx={{ fontSize: 13, lineHeight: 1.6 }}><b>予測：</b>{target.prediction}</Typography>
                    {verdict && <Typography sx={{ fontSize: 13, lineHeight: 1.6 }}><b>結果（{VERDICT[verdict.result] || verdict.result}）：</b>{verdict.observed}</Typography>}
                  </Box>
                );
              })}
              {run.notMovedReason && <Typography sx={{ fontSize: 13, lineHeight: 1.65 }}><b>空振りの理由：</b>{run.notMovedReason}</Typography>}
              {run.nextStep && <Typography sx={{ fontSize: 13, lineHeight: 1.65 }}><b>次の一手：</b>{run.nextStep}</Typography>}
              {(run.movedItemIds || []).length > 0 && <Mono size={11.5}>動いた定点: {run.movedItemIds.join(', ')}</Mono>}
            </Box>
          </Collapse>
        </Box>
      </Box>
    </Box>
  );
}

function Achievement({ item, onDecide, busy }) {
  const pending = item.status === 'candidate';
  return (
    <Box sx={{ py: 1.4, borderBottom: '1px solid ' + V.rule, display: 'grid', gridTemplateColumns: { xs: '1fr', md: '150px minmax(0,1fr) auto' }, columnGap: 3, rowGap: 0.8, alignItems: 'start' }}>
      <Stack direction={{ xs: 'row', md: 'column' }} gap={{ xs: 1.2, md: 0.4 }}>
        <Mono color={V.ink} size={12.5}>{item.id}</Mono>
        <Mono size={11.5}>{formatDate(item.foundAt)}{item.runId ? ' · ' + item.runId : ''}</Mono>
      </Stack>
      <Box sx={{ minWidth: 0 }}>
        <Typography sx={{ fontSize: 15, fontWeight: 800 }}>{item.label}</Typography>
        <Typography sx={{ fontSize: 13.5, mt: 0.3, lineHeight: 1.65, color: V.muted }}>{item.evidence}</Typography>
        {item.ref && <Typography sx={{ fontSize: 12, mt: 0.3, color: V.muted }}>参照: <MaybeLink text={item.ref} /></Typography>}
        {!pending && item.decisionNote && <Typography sx={{ fontSize: 12, mt: 0.3, color: V.faint }}>{item.decisionNote}</Typography>}
      </Box>
      {pending && (
        <Stack direction="row" gap={1}>
          <Button size="small" variant="contained" disabled={busy} onClick={() => onDecide(item, 'confirmed')}>確定</Button>
          <Button size="small" variant="outlined" disabled={busy} onClick={() => onDecide(item, 'declined')}>見送り</Button>
        </Stack>
      )}
    </Box>
  );
}

function BaseList({ items, onOpen }) {
  if (!items.length) return <Empty>まだ探索拠点がありません。エージェントが exploration_base_create で作ります。</Empty>;
  return (
    <Box sx={{ borderTop: '1px solid ' + V.ink }}>
      {items.map((base) => (
        <Box key={base.id} component="button" type="button" onClick={() => onOpen(base.id)}
          sx={{
            all: 'unset', boxSizing: 'border-box', width: '100%', cursor: 'pointer', display: 'grid',
            gridTemplateColumns: { xs: '1fr', md: 'minmax(0,1fr) 260px' }, columnGap: 3, rowGap: 0.6,
            py: 2, px: 0.5, borderBottom: '1px solid ' + V.rule,
            '&:hover': { background: V.accentSoft }, '&:focus-visible': { outline: '2px solid ' + V.accent },
          }}>
          <Box sx={{ minWidth: 0 }}>
            <Stack direction="row" gap={1} alignItems="center">
              <Dot color={base.status === 'active' ? V.green : V.faint} />
              <Typography sx={{ fontSize: 16, fontWeight: 800 }}>{base.title}</Typography>
            </Stack>
            <Typography sx={{ fontSize: 13.5, color: V.muted, mt: 0.4, lineHeight: 1.6 }}>{base.outcome?.statement || base.summary}</Typography>
          </Box>
          <Stack gap={0.3} sx={{ alignSelf: 'center' }}>
            <Mono color={V.ink}>成果 {base.confirmedCount} / {targetText(base.outcome?.target)}</Mono>
            <Mono>{(base.methodVersion || '探索法未設定') + ' · run ' + base.runCount + (base.stalledRuns ? ' · 空振り ' + base.stalledRuns : '')}</Mono>
            {base.openRunId && <Mono color={V.accent}>{base.openRunId} 実行中</Mono>}
          </Stack>
        </Box>
      ))}
    </Box>
  );
}

function BaseDetail({ detail, onDecide, busy }) {
  const [showClosed, setShowClosed] = useState(false);
  const { base, outcome = {}, method, full = {}, position = {} } = detail;
  const hypotheses = full.hypotheses || [];
  const openHypotheses = hypotheses.filter((item) => item.status === 'open');
  const closedHypotheses = hypotheses.filter((item) => item.status !== 'open');
  const constraints = full.constraints || [];
  const achievements = [...(outcome.awaitingConfirmation || []), ...(outcome.confirmed || [])];
  const warnings = warningsOf(detail);
  const pendingProposals = (full.proposals || []).filter((proposal) => proposal.status === 'pending');
  const url = methodUrl(method?.bodyRef);
  const winCount = openHypotheses.filter((item) => item.stage === 'yielded_candidate' || item.stage === 'yielded_outcome').length;

  return (
    <Box>
      <Box sx={{ mt: 1 }}>
        <Typography sx={{ fontSize: { xs: 22, md: 26 }, fontWeight: 900, letterSpacing: '-0.02em', lineHeight: 1.3 }}>{base.title}</Typography>
        <Typography sx={{ fontSize: 14, color: V.muted, mt: 0.6, maxWidth: 820, lineHeight: 1.7 }}>{base.summary}</Typography>
        <Box sx={{ mt: 1.2 }}>
          <Mono color={V.ink}>
            {'成果 ' + (outcome.confirmedCount || 0) + ' / ' + targetText(outcome.target)
              + ' · 勝ちパターン ' + winCount
              + ' · 仮説 ' + openHypotheses.length + '（棄却・引退 ' + closedHypotheses.length + '）'
              + ' · run ' + (position.runCount || 0)
              + ' · 更新 ' + formatDate(base.updatedAt)}
          </Mono>
        </Box>
      </Box>

      {warnings.map((text) => <Alert key={text} severity="warning" sx={{ mt: 2 }}>{text}</Alert>)}
      {(outcome.awaitingConfirmation || []).length > 0 && (
        <Alert severity="info" sx={{ mt: 2 }}>本人の判断を待っている候補が {outcome.awaitingConfirmation.length} 件あります。下の「01 成果条件」で確定か見送りを選べます。</Alert>
      )}

      <Section index="01 — 成果条件" title="何が見つかれば終わりか" subtitle="成果条件は本人のもの。エージェントは変更を提案できるが、自分では変えない。">
        <Typography sx={{ fontSize: 16, fontWeight: 750, lineHeight: 1.7, py: 1.4, borderBottom: '1px solid ' + V.rule }}>{outcome.statement}</Typography>
        <Field label="数える単位">{outcome.unit}</Field>
        <Field label="目標"><Mono color={V.ink} size={14}>{targetText(outcome.target)}</Mono>{outcome.reached && <Typography component="span" sx={{ ml: 1, color: V.green, fontWeight: 800, fontSize: 13 }}>達成</Typography>}</Field>
        <Field label="合格の判定">{outcome.acceptance}</Field>
        <Field label="確定する人">{outcome.confirmedBy === 'measurement' ? '測定で自動的に確定' : '本人が確定する'}</Field>
        <Field label="期限">{outcome.deadline || 'なし'}</Field>
        <Field label="最終指標">{outcome.finalIndicator}</Field>
        <Field label="代理指標">
          {(outcome.proxies || []).length ? <>{outcome.proxies.join('、')}<Typography sx={{ fontSize: 12, color: V.faint }}>これらが増えても成果には数えない。</Typography></> : null}
        </Field>
        <Field label="止める条件">{(outcome.stopConditions || []).length ? outcome.stopConditions.map((text) => <Box key={text}>{text}</Box>) : null}</Field>
        <Field label="上限">{outcome.budget?.maxRuns ? outcome.budget.maxRuns + ' run' : outcome.budget?.note}</Field>
        <Field label="位置づけ">{outcome.priority}</Field>

        <Typography sx={{ mt: 2.5, mb: 0.5, fontSize: 14, fontWeight: 800 }}>見つかった候補と成果 <Mono>{achievements.length}</Mono></Typography>
        {achievements.length ? achievements.map((item) => <Achievement key={item.id} item={item} onDecide={onDecide} busy={busy} />)
          : <Empty>まだ候補はありません。</Empty>}

        {pendingProposals.length > 0 && (
          <>
            <Typography sx={{ mt: 2.5, mb: 0.5, fontSize: 14, fontWeight: 800 }}>成果条件の変更提案 <Mono>{pendingProposals.length}</Mono></Typography>
            {pendingProposals.map((proposal) => (
              <Box key={proposal.id} sx={{ py: 1.2, borderBottom: '1px solid ' + V.rule }}>
                <Mono color={V.ink}>{proposal.id + ' · ' + formatDate(proposal.proposedAt)}</Mono>
                <Typography sx={{ fontSize: 13.5, mt: 0.3, lineHeight: 1.65 }}>{proposal.reason}</Typography>
                {proposal.proposed?.statement && <Typography sx={{ fontSize: 13, mt: 0.3, color: V.muted }}>提案: {proposal.proposed.statement}（目標 {targetText(proposal.proposed.target)}）</Typography>}
                <Typography sx={{ fontSize: 12, mt: 0.3, color: V.faint }}>採否はチャットでエージェントに伝えてください。</Typography>
              </Box>
            ))}
          </>
        )}
      </Section>

      <Section index="02 — 本体" title="探索法" count={method?.version}
        subtitle="手順・閾値・採点規則の本文は一か所に置き、ここには所在と現行版と変更の経緯だけを持つ。">
        {method ? (
          <>
            <Field label="名前">{method.title}</Field>
            <Field label="現行版"><Mono color={V.ink} size={14}>{method.version}</Mono><Mono size={11.5}>{'  ' + formatDate(method.setAt)}</Mono></Field>
            <Field label="要約">{method.summary}</Field>
            <Field label="本文の場所">
              {url ? <Link href={url} target="_blank" rel="noreferrer" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.4, overflowWrap: 'anywhere' }}>
                {(method.bodyRef?.location || '') + (method.bodyRef?.path ? ' / ' + method.bodyRef.path : '')}<OpenInNew sx={{ fontSize: 14 }} />
              </Link> : (method.bodyRef?.location || '') + (method.bodyRef?.path ? ' / ' + method.bodyRef.path : '')}
            </Field>
            <Field label="ベンチマーク">{method.benchmarkRef}</Field>
            {method.body && <Field label="本文"><Box component="pre" sx={{ m: 0, whiteSpace: 'pre-wrap', fontFamily: 'inherit', fontSize: 13.5 }}>{method.body}</Box></Field>}
            <Typography sx={{ mt: 2.5, mb: 0.5, fontSize: 14, fontWeight: 800 }}>版の履歴 <Mono>{(full.methodHistory || []).length}</Mono></Typography>
            {[...(full.methodHistory || [])].reverse().map((entry, index) => (
              <Box key={entry.version + index} sx={{ py: 1.1, borderBottom: '1px solid ' + V.rule, display: 'grid', gridTemplateColumns: { xs: '1fr', md: '150px minmax(0,1fr)' }, columnGap: 3 }}>
                <Stack gap={0.3}><Mono color={V.ink}>{entry.version}</Mono><Mono size={11.5}>{formatDate(entry.setAt)}</Mono></Stack>
                <Box>
                  <Typography sx={{ fontSize: 13.5, lineHeight: 1.65 }}>{entry.summary}</Typography>
                  {(entry.motivatingRunIds || []).length > 0 && <Mono size={11.5}>きっかけ: {entry.motivatingRunIds.join(', ')}</Mono>}
                  {entry.benchmark && <Typography sx={{ fontSize: 12, color: V.muted }}>ベンチ: {toText(entry.benchmark)}</Typography>}
                </Box>
              </Box>
            ))}
          </>
        ) : <Empty>探索法がまだ設定されていません。</Empty>}
      </Section>

      <Section index="03 — 仮説台帳" title="有望な仮説と勝ちパターン" count={openHypotheses.length}
        subtitle="推測 → 観測 → 再現 → 候補を生んだ → 成果を生んだ。勝ちパターンと呼ぶのは最後の二つだけ。">
        {STAGES.map((stage) => {
          const list = openHypotheses.filter((item) => item.stage === stage.key);
          if (!list.length) return null;
          return (
            <Box key={stage.key} sx={{ mt: 1.8 }}>
              <Stack direction="row" gap={0.8} alignItems="center" sx={{ pb: 0.4 }}>
                <Dot color={stage.color} />
                <Typography sx={{ fontSize: 13, fontWeight: 800, color: stage.color }}>{stage.label}</Typography>
                <Mono size={11.5}>{list.length}</Mono>
                <Typography sx={{ fontSize: 12, color: V.faint }}>{stage.note}</Typography>
              </Stack>
              {list.map((item) => <Hypothesis key={item.id} item={item} />)}
            </Box>
          );
        })}
        {!openHypotheses.length && <Empty>有効な仮説はありません。</Empty>}
        {closedHypotheses.length > 0 && (
          <Box sx={{ mt: 2 }}>
            <Button size="small" onClick={() => setShowClosed((value) => !value)} endIcon={showClosed ? <ExpandLess /> : <ExpandMore />}
              sx={{ px: 0, color: V.muted, fontWeight: 700 }}>
              棄却・引退した仮説 {closedHypotheses.length} 件（同じ推論を繰り返さないために残している）
            </Button>
            <Collapse in={showClosed} unmountOnExit>
              {closedHypotheses.map((item) => <Hypothesis key={item.id} item={item} />)}
            </Collapse>
          </Box>
        )}
      </Section>

      <Section index="04 — 制約" title="守ること・測れないこと" count={constraints.filter((item) => item.status === 'active').length}>
        {OWNERS.map((owner) => {
          const list = constraints.filter((item) => item.owner === owner.key);
          return (
            <Box key={owner.key} sx={{ mt: 1.8 }}>
              <Stack direction="row" gap={0.8} alignItems="baseline" sx={{ pb: 0.4 }}>
                <Typography sx={{ fontSize: 13, fontWeight: 800 }}>{owner.label}</Typography>
                <Mono size={11.5}>{list.length}</Mono>
                <Typography sx={{ fontSize: 12, color: V.faint }}>{owner.note}</Typography>
              </Stack>
              {list.length ? list.map((item) => (
                <Box key={item.id} sx={{ py: 1.1, borderBottom: '1px solid ' + V.rule, display: 'grid', gridTemplateColumns: { xs: '1fr', md: '150px minmax(0,1fr)' }, columnGap: 3, rowGap: 0.3, opacity: item.status === 'active' ? 1 : 0.6 }}>
                  <Stack direction={{ xs: 'row', md: 'column' }} gap={{ xs: 1.2, md: 0.3 }}>
                    <Mono color={V.ink} size={12.5}>{item.id}</Mono>
                    {item.status !== 'active' && <Mono size={11.5}>{item.status === 'relaxed' ? '緩和' : '廃止'}</Mono>}
                  </Stack>
                  <Box sx={{ minWidth: 0 }}>
                    <Typography sx={{ fontSize: 14, lineHeight: 1.65 }}>{item.statement}</Typography>
                    {(item.rationale || item.basis) && <Typography sx={{ fontSize: 12.5, color: V.muted, mt: 0.3, lineHeight: 1.6 }}>{item.rationale || item.basis}</Typography>}
                    {item.check && <Typography sx={{ fontSize: 12.5, color: V.muted, mt: 0.3 }}><b>確認方法：</b>{item.check}</Typography>}
                    {(item.legacyIds || []).length > 0 && <Mono size={11}>旧ID: {item.legacyIds.join(', ')}</Mono>}
                  </Box>
                </Box>
              )) : <Empty>なし</Empty>}
            </Box>
          );
        })}
      </Section>

      <Section index="05 — 実行記録" title="run" count={(full.runs || []).length}
        subtitle="run の開始時に試す仮説と予測を宣言し、終了時に当たり外れを記録する。どの定点も動かなかった run は空振りとして数える。">
        {(full.runs || []).length ? full.runs.map((run) => <Run key={run.id} run={run} />)
          : <Empty>まだ記録された run はありません。</Empty>}
      </Section>

      <Section index="06 — 変更履歴" title="この拠点で起きたこと" count={(full.events || []).length}>
        {(full.events || []).length ? full.events.map((event) => (
          <Box key={event.seq} sx={{ py: 0.9, borderBottom: '1px solid ' + V.rule, display: 'grid', gridTemplateColumns: { xs: '1fr', md: '150px 170px minmax(0,1fr)' }, columnGap: 2, rowGap: 0.2 }}>
            <Mono size={11.5}>{formatDate(event.createdAt, true)}</Mono>
            <Typography sx={{ fontSize: 12.5, fontWeight: 700 }}>
              {(EVENT_LABEL[event.type] || event.type) + (event.itemId ? ' ' : '')}{event.itemId && <Mono color={V.ink}>{event.itemId}</Mono>}{event.runId && <Mono>{' · ' + event.runId}</Mono>}
            </Typography>
            <Box sx={{ minWidth: 0 }}>
              <Typography sx={{ fontSize: 13, lineHeight: 1.6, overflowWrap: 'anywhere' }}>{event.summary}</Typography>
              {event.actor && <Mono size={11}>{event.actor}</Mono>}
            </Box>
          </Box>
        )) : <Empty>履歴はありません。</Empty>}
      </Section>

      <Typography sx={{ mt: 4, fontSize: 12, color: V.faint }}>
        <Mono size={11}>{base.id}</Mono>　正本のデータ: {(base.canonicalData || []).join(' / ') || '—'}
      </Typography>
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

  const loadList = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await api('?resource=exploration_bases');
      setItems(Array.isArray(data.items) ? data.items : []);
    } catch (err) {
      setError('探索拠点を読み込めません: ' + err.message);
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
      setError('拠点を読み込めません: ' + err.message);
    } finally {
      setDetailLoading(false);
    }
  }, []);

  useEffect(() => { loadList(); }, [loadList]);
  useEffect(() => { loadDetail(selectedId); }, [loadDetail, selectedId]);

  const totals = useMemo(() => ({
    open: items.filter((base) => base.openRunId).length,
    runs: items.reduce((sum, base) => sum + (base.runCount || 0), 0),
  }), [items]);

  const open = (id) => setParams(id ? { id } : {});

  const decide = async () => {
    if (!decision) return;
    setBusy(true);
    setError('');
    try {
      await api('', {
        action: 'exploration_achievement_decide', baseId: selectedId,
        id: decision.item.id, decision: decision.value, note: note.trim(),
      });
      setNotice(decision.item.label + ' を' + (decision.value === 'confirmed' ? '確定しました' : '見送りました'));
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
    <Box sx={{ maxWidth: 1080, mx: 'auto', pb: 8 }}>
      <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" alignItems={{ sm: 'flex-end' }} gap={1.5}>
        <Box>
          <Typography variant="overline" sx={{ color: V.faint, display: 'block' }}>EXPLORATION BASES</Typography>
          <Typography component="h1" sx={{ fontSize: { xs: 24, md: 28 }, fontWeight: 900, letterSpacing: '-0.03em' }}>探索拠点</Typography>
          <Typography sx={{ fontSize: 13.5, color: V.muted, mt: 0.4, maxWidth: 720, lineHeight: 1.65 }}>
            答えの分からない探索をエージェントに任せるときの定点。成果条件・探索法の版・仮説・制約・実行記録を探索ごとに一か所で持つ。
          </Typography>
          <Box sx={{ mt: 0.8 }}>
            <Mono color={V.ink}>{items.length + ' 拠点 · run 累計 ' + totals.runs + (totals.open ? ' · 実行中 ' + totals.open : '')}</Mono>
          </Box>
        </Box>
        <Stack direction="row" gap={1}>
          {selectedId && <Button variant="outlined" onClick={() => open('')}>一覧へ</Button>}
          <Button variant="outlined" startIcon={<Refresh />} disabled={loading || detailLoading}
            onClick={() => { loadList(); loadDetail(selectedId); }}>再読み込み</Button>
        </Stack>
      </Stack>

      {error && <Alert severity="error" onClose={() => setError('')} sx={{ mt: 2 }}>{error}</Alert>}
      {notice && <Alert severity="success" onClose={() => setNotice('')} sx={{ mt: 2 }}>{notice}</Alert>}

      {selectedId && items.length > 1 && (
        <Stack direction="row" gap={0.6} flexWrap="wrap" sx={{ mt: 2.5 }}>
          {items.map((base) => (
            <Button key={base.id} size="small" onClick={() => open(base.id)}
              variant={base.id === selectedId ? 'contained' : 'outlined'} sx={{ textTransform: 'none' }}>
              {base.title}
            </Button>
          ))}
        </Stack>
      )}

      <Box sx={{ mt: 3 }}>
        {loading && !items.length ? (
          <Box sx={{ display: 'grid', placeItems: 'center', py: 7 }}><CircularProgress /></Box>
        ) : !selectedId ? (
          <BaseList items={items} onOpen={open} />
        ) : detailLoading && !detail ? (
          <Box sx={{ display: 'grid', placeItems: 'center', py: 7 }}><CircularProgress /></Box>
        ) : detail ? (
          <BaseDetail detail={detail} busy={busy} onDecide={(item, value) => { setDecision({ item, value }); setNote(''); }} />
        ) : null}
      </Box>

      <Dialog open={Boolean(decision)} onClose={() => !busy && setDecision(null)} fullWidth maxWidth="sm">
        <DialogTitle>{decision?.value === 'confirmed' ? '成果として確定する' : '候補を見送る'}</DialogTitle>
        <DialogContent dividers>
          <Typography sx={{ fontWeight: 800 }}>{decision?.item.label}</Typography>
          <Typography sx={{ fontSize: 13.5, color: V.muted, mt: 0.5, mb: 2, lineHeight: 1.65 }}>
            {decision?.value === 'confirmed'
              ? '確定すると成果の件数に数えられ、エージェントは次の run からこの結果を前提にします。'
              : '見送った候補は成果に数えません。記録は残ります。'}
          </Typography>
          <TextField fullWidth size="small" label="メモ（任意）" value={note} onChange={(event) => setNote(event.target.value)}
            multiline minRows={2} inputProps={{ maxLength: 500 }}
            helperText={decision?.value === 'declined' ? '見送った理由があると、エージェントが次の探索で同じ方向を避けられます。' : ''} />
        </DialogContent>
        <DialogActions sx={{ px: 2, py: 1.5 }}>
          <Button onClick={() => setDecision(null)} disabled={busy}>キャンセル</Button>
          <Button variant="contained" onClick={decide} disabled={busy}>
            {busy ? '保存中…' : decision?.value === 'confirmed' ? '確定する' : '見送る'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
