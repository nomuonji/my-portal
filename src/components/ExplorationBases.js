import React, { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Alert, Box, Button, CircularProgress, Collapse, Dialog, DialogActions, DialogContent, DialogTitle,
  Link, Stack, Tab, Tabs, TextField, Typography,
} from '@mui/material';
import { ArrowBack, ExpandLess, ExpandMore, OpenInNew, Refresh } from '@mui/icons-material';
import { auth } from '../firebase';
import { toText } from './jobOpportunityView';

// 探索拠点. The page answers, in this order: how far along is it, is anything waiting for me,
// what is the current best guess, and what happened recently. The full ledger (every hypothesis,
// constraint, method version, event) stays behind 「詳しく見る」 for when it is actually needed.

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
const OWNER = { user: 'あなたが決めたこと', environment: '道具やデータの限界', agent: 'エージェントの進め方' };
const VERDICT = { supported: '当たり', contradicted: '外れ', inconclusive: '判定できず' };
const EVENT_LABEL = {
  base_created: '拠点を作成', base_described: '名前・説明を変更', outcome_set: 'ゴールを変更',
  outcome_proposed: 'ゴールの変更を提案', method_version_set: '探索法を更新', hypothesis_created: '見立てを追加',
  hypothesis_updated: '見立てを更新', constraint_created: '制約を追加', constraint_updated: '制約を更新',
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

function targetText(target) {
  if (!target) return '—';
  return target.max && target.max !== target.min ? target.min + '〜' + target.max : String(target.min);
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
  if (state.reached) return { text: '目標に届きました', color: V.green };
  if (state.awaitingCount > 0) return { text: 'あなたの判断を待っている候補が ' + state.awaitingCount + ' 件あります', color: V.accent };
  if (state.pendingProposalCount > 0) return { text: 'ゴールの変更提案が ' + state.pendingProposalCount + ' 件届いています', color: V.accent };
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

function Progress({ confirmed, target, big = false }) {
  return (
    <Box sx={{ textAlign: { xs: 'left', md: 'right' } }}>
      <Typography sx={{ fontSize: big ? 34 : 24, fontWeight: 900, lineHeight: 1, letterSpacing: '-0.02em' }}>
        {confirmed}<Typography component="span" sx={{ fontSize: big ? 18 : 14, color: V.muted, fontWeight: 700 }}> / {targetText(target)}</Typography>
      </Typography>
      <Typography sx={{ fontSize: 11.5, color: V.muted, mt: 0.5 }}>確定した成果</Typography>
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

// ---- 詳しく見る -------------------------------------------------------------

function DetailRow({ label, children }) {
  if (children === null || children === undefined || children === '' || (Array.isArray(children) && !children.length)) return null;
  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '120px minmax(0,1fr)' }, columnGap: 2, py: 1, borderBottom: '1px solid ' + V.rule }}>
      <Typography sx={{ fontSize: 12.5, color: V.muted }}>{label}</Typography>
      <Box sx={{ fontSize: 13.5, lineHeight: 1.65, minWidth: 0, overflowWrap: 'anywhere' }}>{children}</Box>
    </Box>
  );
}

function HypothesisDetail({ item }) {
  const [open, setOpen] = useState(false);
  const closed = item.status !== 'open';
  const stage = STAGE[item.stage] || { label: item.stage, color: V.faint };
  const evidence = item.evidence || [];
  const counter = item.counterexamples || [];
  return (
    <Box sx={{ py: 1.2, borderBottom: '1px solid ' + V.rule }}>
      <Stack direction="row" gap={1} alignItems="baseline" flexWrap="wrap">
        <Typography sx={{ fontSize: 14, fontWeight: 750 }}>{item.title}</Typography>
        <Small>{closed ? (item.status === 'rejected' ? '棄却' : '引退') : stage.label}</Small>
      </Stack>
      <Typography sx={{ fontSize: 13, color: V.muted, mt: 0.3, lineHeight: 1.65 }}>
        {closed ? (item.statusReason || item.statement) : item.statement}
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
              {counter.map((entry, index) => <Box key={'c' + index} sx={{ mb: 0.6, color: V.pink }}>反例：{toText(entry.ref || entry)}</Box>)}
            </Box>
          </Collapse>
        </>
      )}
    </Box>
  );
}

function Details({ detail }) {
  const [tab, setTab] = useState('hypotheses');
  const { outcome = {}, method, full = {} } = detail;
  const hypotheses = [...(full.hypotheses || [])].sort((a, b) => {
    const order = (item) => (item.status === 'open' ? (STAGE[item.stage]?.rank ?? 9) : item.status === 'rejected' ? 20 : 30);
    return order(a) - order(b);
  });
  const constraints = (full.constraints || []).filter((item) => item.status === 'active');
  const url = methodUrl(method?.bodyRef);
  return (
    <Box sx={{ mt: 1 }}>
      <Tabs value={tab} onChange={(_, value) => setTab(value)} variant="scrollable" allowScrollButtonsMobile sx={{ borderBottom: '1px solid ' + V.rule, minHeight: 40, '& .MuiTab-root': { minHeight: 40, fontSize: 13 } }}>
        <Tab value="hypotheses" label={'見立て ' + hypotheses.length} />
        <Tab value="constraints" label={'制約 ' + constraints.length} />
        <Tab value="goal" label="ゴールの条件" />
        <Tab value="method" label="探索法" />
        <Tab value="history" label="履歴" />
      </Tabs>

      {tab === 'hypotheses' && (
        <Box>
          <Quiet>棄却・引退した見立ても、同じ推論を繰り返さないために残しています。</Quiet>
          {hypotheses.map((item) => <HypothesisDetail key={item.id} item={item} />)}
        </Box>
      )}

      {tab === 'constraints' && ['user', 'environment', 'agent'].map((owner) => {
        const list = constraints.filter((item) => item.owner === owner);
        if (!list.length) return null;
        return (
          <Box key={owner} sx={{ mt: 2 }}>
            <Typography sx={{ fontSize: 13, fontWeight: 800 }}>{OWNER[owner]} <Small>{list.length}</Small></Typography>
            {list.map((item) => (
              <Box key={item.id} sx={{ py: 1, borderBottom: '1px solid ' + V.rule }}>
                <Typography sx={{ fontSize: 13.5, lineHeight: 1.65 }}>{item.statement}</Typography>
                {(item.rationale || item.basis) && <Typography sx={{ fontSize: 12, color: V.muted, mt: 0.2 }}>{item.rationale || item.basis}</Typography>}
              </Box>
            ))}
          </Box>
        );
      })}

      {tab === 'goal' && (
        <Box sx={{ mt: 1 }}>
          <DetailRow label="数える単位">{outcome.unit}</DetailRow>
          <DetailRow label="合格の判定">{outcome.acceptance}</DetailRow>
          <DetailRow label="期限">{outcome.deadline || 'なし'}</DetailRow>
          <DetailRow label="その先に見る指標">{outcome.finalIndicator}</DetailRow>
          <DetailRow label="成果に数えないもの">{(outcome.proxies || []).join('、')}</DetailRow>
          <DetailRow label="止める条件">{(outcome.stopConditions || []).map((text) => <Box key={text}>{text}</Box>)}</DetailRow>
        </Box>
      )}

      {tab === 'method' && (method ? (
        <Box sx={{ mt: 1 }}>
          <DetailRow label="名前">{method.title}</DetailRow>
          <DetailRow label="現行版">{method.version}</DetailRow>
          <DetailRow label="内容">{method.summary}</DetailRow>
          <DetailRow label="本文">
            {url ? <Link href={url} target="_blank" rel="noreferrer" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.4 }}>
              {method.bodyRef?.path || method.bodyRef?.location}<OpenInNew sx={{ fontSize: 14 }} />
            </Link> : method.bodyRef?.location}
          </DetailRow>
          {(full.methodHistory || []).length > 1 && (
            <DetailRow label="これまでの版">
              {[...full.methodHistory].reverse().map((entry) => <Box key={entry.version}>{entry.version}：{entry.summary} <Small>{shortDate(entry.setAt)}</Small></Box>)}
            </DetailRow>
          )}
        </Box>
      ) : <Quiet>探索法はまだ設定されていません。</Quiet>)}

      {tab === 'history' && (
        <Box sx={{ mt: 1 }}>
          {(full.events || []).map((event) => (
            <Box key={event.seq} sx={{ display: 'grid', gridTemplateColumns: '64px minmax(0,1fr)', columnGap: 1.5, py: 0.8, borderBottom: '1px solid ' + V.rule }}>
              <Small>{shortDate(event.createdAt)}</Small>
              <Typography sx={{ fontSize: 13, lineHeight: 1.6 }}>
                <b>{EVENT_LABEL[event.type] || event.type}</b>　{event.summary}
              </Typography>
            </Box>
          ))}
          {!(full.events || []).length && <Quiet>履歴はありません。</Quiet>}
        </Box>
      )}
    </Box>
  );
}

// ---- Detail page ------------------------------------------------------------

function BaseDetail({ detail, onDecide, busy }) {
  const [showDetails, setShowDetails] = useState(false);
  const { base, outcome = {}, full = {}, position = {} } = detail;
  const awaiting = outcome.awaitingConfirmation || [];
  const proposals = (full.proposals || []).filter((proposal) => proposal.status === 'pending');
  const hypotheses = full.hypotheses || [];
  const leading = hypotheses
    .filter((item) => item.status === 'open' && (STAGE[item.stage]?.rank ?? 9) <= 3)
    .sort((a, b) => STAGE[a.stage].rank - STAGE[b.stage].rank)
    .slice(0, 5);
  const others = {
    open: hypotheses.filter((item) => item.status === 'open').length - leading.length,
    closed: hypotheses.filter((item) => item.status !== 'open').length,
  };
  const runs = (full.runs || []).slice(0, 3);
  const state = {
    status: base.status, reached: outcome.reached, awaitingCount: awaiting.length,
    pendingProposalCount: proposals.length, stalledRuns: position.stalledRuns, openRunId: position.openRunId,
    runCount: position.runCount, lastRun: (position.lastRuns || [])[0],
  };

  return (
    <Box>
      <Typography component="h1" sx={{ fontSize: { xs: 22, md: 26 }, fontWeight: 900, letterSpacing: '-0.02em', lineHeight: 1.3 }}>{base.title}</Typography>
      <Typography sx={{ fontSize: 14, color: V.muted, mt: 0.6, maxWidth: 760, lineHeight: 1.7 }}>{base.summary}</Typography>

      <Box sx={{ mt: 3, py: 2.2, borderTop: '1px solid ' + V.ink, borderBottom: '1px solid ' + V.rule, display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'minmax(0,1fr) auto' }, gap: 2, alignItems: 'center' }}>
        <Box>
          <Status state={state} size={15} />
          {state.lastRun?.nextStep && <Typography sx={{ fontSize: 13, color: V.muted, mt: 0.6, pl: 2 }}>次の一手：{state.lastRun.nextStep}</Typography>}
        </Box>
        <Progress confirmed={outcome.confirmedCount || 0} target={outcome.target} big />
      </Box>

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
              {proposal.proposed?.statement && <Typography sx={{ fontSize: 13, color: V.muted, mt: 0.3 }}>提案：{proposal.proposed.statement}（目標 {targetText(proposal.proposed.target)}）</Typography>}
              <Typography sx={{ fontSize: 12, color: V.faint, mt: 0.3 }}>採否はチャットで伝えてください。</Typography>
            </Box>
          ))}
        </>
      )}

      <Heading>ゴール</Heading>
      <Typography sx={{ fontSize: 15.5, fontWeight: 700, lineHeight: 1.7 }}>{outcome.statement}</Typography>

      <Heading aside={others.open + others.closed > 0 ? <Small>ほかに {others.open > 0 ? '検討中 ' + others.open + '件・' : ''}棄却や引退 {others.closed}件</Small> : null}>
        いま有力な見立て
      </Heading>
      {leading.length ? leading.map((item) => (
        <Box key={item.id} sx={{ py: 1.1, borderBottom: '1px solid ' + V.rule }}>
          <Stack direction="row" gap={1} alignItems="baseline" flexWrap="wrap">
            <Typography sx={{ fontSize: 14.5, fontWeight: 800 }}>{item.title}</Typography>
            <Typography component="span" sx={{ fontSize: 11.5, fontWeight: 700, color: STAGE[item.stage].color }}>{STAGE[item.stage].label}</Typography>
          </Stack>
          <Typography sx={{ fontSize: 13.5, color: V.muted, mt: 0.3, lineHeight: 1.65 }}>{item.statement}</Typography>
        </Box>
      )) : <Quiet>まだ観測に裏づけられた見立てはありません。</Quiet>}

      <Heading>最近の実行</Heading>
      {runs.length ? runs.map((run) => {
        const stalled = run.status === 'finished' && run.moved === false;
        return (
          <Box key={run.id} sx={{ py: 1.1, borderBottom: '1px solid ' + V.rule }}>
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
          </Box>
        );
      }) : <Quiet>まだ一度も実行していません。</Quiet>}

      <Button onClick={() => setShowDetails((v) => !v)} endIcon={showDetails ? <ExpandLess /> : <ExpandMore />}
        sx={{ mt: 4, px: 0, color: V.muted, fontWeight: 700 }}>
        {showDetails ? '詳しい記録を閉じる' : '詳しく見る（すべての見立て・制約・探索法・履歴）'}
      </Button>
      <Collapse in={showDetails} unmountOnExit><Details detail={detail} /></Collapse>
    </Box>
  );
}

// ---- List -------------------------------------------------------------------

function BaseList({ items, onOpen }) {
  if (!items.length) return <Quiet>まだ探索拠点はありません。</Quiet>;
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
            <Typography sx={{ fontSize: 13.5, color: V.muted, mt: 0.3, lineHeight: 1.6 }}>{base.outcome?.statement}</Typography>
            <Box sx={{ mt: 0.8 }}><Status state={base} size={13} /></Box>
          </Box>
          <Progress confirmed={base.confirmedCount} target={base.outcome?.target} />
        </Box>
      ))}
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
          <Button startIcon={<ArrowBack />} onClick={() => open('')} sx={{ px: 0, color: V.muted }}>探索拠点の一覧</Button>
        ) : (
          <Box>
            <Typography component="h1" sx={{ fontSize: { xs: 24, md: 28 }, fontWeight: 900, letterSpacing: '-0.03em' }}>探索拠点</Typography>
            <Typography sx={{ fontSize: 13.5, color: V.muted, mt: 0.4, lineHeight: 1.65 }}>
              エージェントに任せている探索ごとに、どこまで進んだかと、あなたの判断が要るものを並べています。
            </Typography>
          </Box>
        )}
        <Button size="small" startIcon={<Refresh />} disabled={loading || detailLoading} sx={{ color: V.muted, flexShrink: 0 }}
          onClick={() => { loadList(); loadDetail(selectedId); }}>再読み込み</Button>
      </Stack>

      {error && <Alert severity="error" onClose={() => setError('')} sx={{ mt: 2 }}>{error}</Alert>}
      {notice && <Alert severity="success" onClose={() => setNotice('')} sx={{ mt: 2 }}>{notice}</Alert>}

      <Box sx={{ mt: selectedId ? 0 : 3 }}>
        {loading && !items.length && !selectedId ? (
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
