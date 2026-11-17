import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Box, Button, CircularProgress, Collapse, Link, Stack, TextField, Typography } from '@mui/material';
import { auth } from '../firebase';

// The haul of every submarine as a timeline. Built like a social timeline so one item costs little attention:
// one column about 600px wide, everything starting at the same left edge, an item of at most four short lines,
// the buttons right under the text, and the details only when the item is opened. Pages of 15 are loaded as the
// reader scrolls, and an evaluation updates the item in place instead of reloading the page.

const V = {
  ink: 'var(--p-ink)', muted: 'var(--p-muted)', faint: 'var(--p-faint)', rule: 'var(--p-rule)',
  accent: 'var(--p-accent)', amber: 'var(--p-amber)', blue: 'var(--p-blue)', green: 'var(--p-green)', pink: 'var(--p-pink)',
};
const SEA = { deep: '#06141d', mid: '#0b2533', glow: '#62e6d8', text: '#cdeff2' };
const MONO = '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace';
const TONE = { good: V.green, neutral: V.blue, bad: V.pink };
const DECIDED = { confirmed: { label: '成果', color: V.green }, declined: { label: '見送り', color: V.faint } };
const PAGE = 15;

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

export function timeAgo(value, now = Date.now()) {
  if (!value) return '';
  const t = Date.parse(value);
  if (Number.isNaN(t)) return '';
  const min = Math.max(0, Math.round((now - t) / 60000));
  if (min < 1) return 'いま';
  if (min < 60) return min + '分前';
  if (min < 60 * 24) return Math.round(min / 60) + '時間前';
  if (min < 60 * 24 * 7) return Math.round(min / 1440) + '日前';
  return new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric' }).format(new Date(t));
}
function hostOf(url) { try { return new URL(url).hostname.replace(/^www\./, ''); } catch (error) { return ''; } }

// Which gear version brought this back. The 道場 compares its versions by these evaluations.
export function versionText(item) {
  const gear = (item.gearVersions || []).filter((g) => g.role !== 'support');
  const shown = gear.length ? gear : (item.gearVersions || []);
  return shown.map((g) => String(g.gear || '').replace(/^chat_skill:/, '').replace(/^intelligence_pack:/, 'Pack ') + (g.version ? ' v' + g.version : '')).join(' + ');
}

function currentAction(item, actions) {
  if (item.record?.kind === 'discover' && actions.some((a) => a.key === item.record.state)) return item.record.state;
  const last = (item.feedback || []).find((f) => f.action);
  if (last) return last.action;
  return item.status === 'candidate' ? '' : (actions.find((a) => a.decision === item.status) || {}).key || '';
}

function Avatar({ hull }) {
  const digits = String(hull || '').replace(/^SS-/, '') || '?';
  return (
    <Box aria-hidden sx={{
      width: 40, height: 40, borderRadius: '50%', flexShrink: 0, display: 'grid', placeItems: 'center',
      background: 'radial-gradient(circle at 35% 30%, #154257 0%, ' + SEA.deep + ' 75%)', border: '2px solid ' + SEA.glow,
      color: SEA.text, fontFamily: MONO, fontSize: 13, fontWeight: 800,
    }}>{digits}</Box>
  );
}

function Detail({ label, children }) {
  if (!children) return null;
  return (
    <Typography sx={{ fontSize: 14, lineHeight: 1.6, mt: 0.8 }}>
      <Box component="span" sx={{ color: V.muted, fontSize: 12.5, display: 'block' }}>{label}</Box>{children}
    </Typography>
  );
}

export function Post({ item, actions = [], onFeedback, busy, now }) {
  const [open, setOpen] = useState(false);
  const [comment, setComment] = useState('');
  const record = item.record || null;
  const title = record?.title || item.label;
  const line = record?.reason || record?.summary || item.evidence || '';
  const rawUrl = record?.url || item.url || '';
  const url = /^https?:\/\//.test(rawUrl) ? rawUrl : '';
  const current = currentAction(item, actions);
  const decided = DECIDED[item.status];
  const version = versionText(item);
  const send = (key) => { onFeedback(item, key, comment.trim()); setComment(''); };
  return (
    <Box component="article" aria-label={title} sx={{
      display: 'grid', gridTemplateColumns: '40px minmax(0,1fr)', columnGap: 1.5, px: 2, py: 1.5,
      borderBottom: '1px solid ' + V.rule, transition: 'background .12s', '&:hover': { background: 'var(--p-sunken)' },
    }}>
      <Avatar hull={item.submarine?.hull} />
      <Box sx={{ minWidth: 0 }}>
        <Stack direction="row" alignItems="baseline" gap={0.6} sx={{ minWidth: 0 }}>
          <Typography component="span" sx={{ fontSize: 14.5, fontWeight: 800, whiteSpace: 'nowrap' }}>{item.submarine?.name || item.submarineId}</Typography>
          <Typography component="span" sx={{ fontSize: 13.5, color: V.faint, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {[item.submarine?.hull, timeAgo(item.decidedAt && decided ? item.decidedAt : item.foundAt, now)].filter(Boolean).join(' · ')}
          </Typography>
          {decided && <Typography component="span" sx={{ ml: 'auto', fontSize: 12, fontWeight: 800, color: decided.color, flexShrink: 0 }}>{decided.label}</Typography>}
        </Stack>
        <Box role="button" tabIndex={0} onClick={() => setOpen((v) => !v)} onKeyDown={(e) => { if (e.key === 'Enter') setOpen((v) => !v); }}
          aria-expanded={open} sx={{ cursor: 'pointer', outline: 'none' }}>
          <Typography sx={{
            fontSize: 15, fontWeight: 700, lineHeight: 1.5, mt: 0.2, overflowWrap: 'anywhere',
            display: '-webkit-box', WebkitLineClamp: open ? 'unset' : 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
          }}>{title}</Typography>
          {record?.kind === 'job' && record.reward && <Typography sx={{ fontSize: 14, color: V.accent, fontWeight: 700 }}>{record.reward}</Typography>}
          {line && (
            <Typography sx={{
              fontSize: 14.5, lineHeight: 1.55, color: V.ink, opacity: 0.86, mt: 0.2,
              display: '-webkit-box', WebkitLineClamp: open ? 'unset' : 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
            }}>{line}</Typography>
          )}
        </Box>
        {url && (
          <Link href={url} target="_blank" rel="noreferrer" underline="hover" sx={{ display: 'inline-block', fontSize: 13, color: V.muted, mt: 0.3 }}>
            {(record?.source || hostOf(url))} ↗
          </Link>
        )}

        <Collapse in={open} unmountOnExit>
          <Box sx={{ mt: 0.5 }}>
            {record?.summary && record.summary !== line && <Detail label="どんなものか">{record.summary}</Detail>}
            <Detail label="入口">{record?.bridge}</Detail>
            <Detail label="最初の一歩">{record?.firstStep}</Detail>
            <Detail label="合わないかもしれない点">{record?.weakness}</Detail>
            {(record?.details || []).map((d) => <Detail key={d.label} label={d.label}>{d.value}</Detail>)}
            {(item.feedback || []).slice(0, 3).map((f, i) => (
              <Typography key={i} sx={{ fontSize: 13, color: V.muted, mt: 0.6 }}>{timeAgo(f.at, now)}　{f.actionLabel}{f.actionLabel && f.comment ? '　' : ''}{f.comment ? '「' + f.comment + '」' : ''}</Typography>
            ))}
            <Typography sx={{ fontFamily: MONO, fontSize: 11, color: V.faint, mt: 0.8 }}>
              {version ? '見つけた装備 ' + version : '見つけた装備の版：記録なし'}{item.sortieId ? '　出航 ' + item.sortieId : ''}
            </Typography>
            <TextField fullWidth size="small" multiline minRows={1} value={comment} onChange={(e) => setComment(e.target.value)} sx={{ mt: 1 }}
              placeholder="ひとこと（次の出航と道場が読みます）" inputProps={{ maxLength: 1000, 'aria-label': 'コメント' }} />
          </Box>
        </Collapse>

        <Stack direction="row" gap={0.75} alignItems="center" flexWrap="wrap" sx={{ mt: 1 }}>
          {actions.map((a) => {
            const active = current === a.key;
            const color = TONE[a.tone] || V.blue;
            return (
              <Button key={a.key} size="small" disabled={busy} aria-pressed={active} onClick={() => send(a.key)}
                sx={{
                  minWidth: 0, minHeight: 30, borderRadius: 999, px: 1.4, py: 0.2, fontSize: 13, fontWeight: 700,
                  border: '1px solid ' + (active ? color : V.rule), color: active ? '#fff' : V.muted, background: active ? color : 'transparent',
                  '&:hover': { borderColor: color, color: active ? '#fff' : V.ink, background: active ? color : 'transparent' },
                }}>{a.label}</Button>
            );
          })}
          {open && comment.trim() && (
            <Button size="small" disabled={busy} onClick={() => send(null)} sx={{ minHeight: 30, fontSize: 13 }}>コメントだけ残す</Button>
          )}
          {!open && <Button size="small" onClick={() => setOpen(true)} sx={{ minWidth: 0, minHeight: 30, fontSize: 13, color: V.faint, ml: 'auto' }}>詳しく</Button>}
        </Stack>
      </Box>
    </Box>
  );
}

const TABS = [{ key: 'candidate', label: '評価待ち' }, { key: 'confirmed', label: '採用済み' }, { key: 'decided', label: '評価済み' }];

export default function HaulTimeline({ fleet = [], fixedSub = '', initialSub = '', onSubChange, onNotice, onError }) {
  const [tab, setTab] = useState('candidate');
  const [sub, setSub] = useState(fixedSub || initialSub || '');
  const [items, setItems] = useState([]);
  const [cursor, setCursor] = useState(null);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [counts, setCounts] = useState({});
  const [actionsBySub, setActionsBySub] = useState({});
  const [busy, setBusy] = useState(false);
  const request = useRef(0);
  const sentinel = useRef(null);
  const now = useMemo(() => Date.now(), [items]); // eslint-disable-line react-hooks/exhaustive-deps

  const load = useCallback(async (reset, from) => {
    const id = ++request.current;
    setLoading(true);
    try {
      const query = '?resource=submarine_haul&limit=' + PAGE + '&status=' + tab + (sub ? '&sub=' + encodeURIComponent(sub) : '') + (!reset && from ? '&cursor=' + encodeURIComponent(from) : '');
      const data = await api(query);
      if (id !== request.current) return;
      setItems((prev) => (reset ? data.items || [] : [...prev, ...(data.items || [])]));
      setCursor(data.nextCursor || null);
      setCounts(data.counts || {});
      setActionsBySub((prev) => ({ ...prev, ...(data.actionsBySubmarine || {}) }));
      setLoaded(true);
    } catch (err) {
      if (id === request.current && onError) onError('成果を読み込めません: ' + err.message);
    } finally {
      if (id === request.current) setLoading(false);
    }
  }, [tab, sub, onError]);

  useEffect(() => { setItems([]); setCursor(null); setLoaded(false); load(true, null); }, [load]);

  // Load the next page when the end of the list comes into view.
  useEffect(() => {
    const node = sentinel.current;
    if (!node || !cursor || typeof IntersectionObserver === 'undefined') return undefined;
    const observer = new IntersectionObserver((entries) => { if (entries.some((e) => e.isIntersecting) && !loading) load(false, cursor); }, { rootMargin: '400px' });
    observer.observe(node);
    return () => observer.disconnect();
  }, [cursor, loading, load]);

  const pickSub = (id) => { setSub(id); if (onSubChange) onSubChange(id); };

  const feedback = async (item, key, comment) => {
    setBusy(true);
    try {
      const result = await api('', { action: 'submarine_haul_feedback', submarineId: item.submarineId, haulId: item.id, feedbackAction: key || '', comment: comment || '', light: true });
      const updated = { ...item, ...(result.haul || {}), record: item.record, submarine: item.submarine };
      if (key && item.record?.kind === 'discover') updated.record = { ...item.record, state: key };
      const leaves = tab === 'decided' ? updated.status === 'candidate' : updated.status !== tab;
      setItems((prev) => (leaves ? prev.filter((h) => !(h.submarineId === item.submarineId && h.id === item.id)) : prev.map((h) => (h.submarineId === item.submarineId && h.id === item.id ? updated : h))));
      if (item.status !== updated.status) {
        setCounts((prev) => {
          const c = { ...(prev[item.submarineId] || { candidate: 0, confirmed: 0 }) };
          if (c[item.status] !== undefined) c[item.status] = Math.max(0, c[item.status] - 1);
          if (c[updated.status] !== undefined) c[updated.status] += 1;
          return { ...prev, [item.submarineId]: c };
        });
      }
      const label = key ? ((result.actions || []).find((a) => a.key === key) || {}).label || key : 'コメント';
      if (onNotice) onNotice(label + '：' + (item.record?.title || item.label));
    } catch (err) {
      if (onError) onError(err.message || '保存に失敗しました');
    } finally { setBusy(false); }
  };

  const tabCount = (status) => fixedSub || sub
    ? counts[fixedSub || sub]?.[status] || 0
    : Object.values(counts).reduce((sum, c) => sum + (c[status] || 0), 0);
  const subsWithItems = fleet.filter((s) => s.status !== 'decommissioned');

  return (
    <Box sx={{ maxWidth: 600, mx: 'auto', borderLeft: { sm: '1px solid ' + V.rule }, borderRight: { sm: '1px solid ' + V.rule } }}>
      <Box sx={{ position: 'sticky', top: 0, zIndex: 2, background: 'var(--p-paper, #fff)', borderBottom: '1px solid ' + V.rule }}>
        <Stack direction="row" role="tablist">
          {TABS.map((t) => (
            <Button key={t.key} role="tab" aria-selected={tab === t.key} onClick={() => setTab(t.key)} disableRipple
              sx={{
                flex: 1, borderRadius: 0, py: 1.4, fontSize: 14.5, fontWeight: tab === t.key ? 800 : 600, color: tab === t.key ? V.ink : V.muted,
                borderBottom: '3px solid ' + (tab === t.key ? V.accent : 'transparent'),
              }}>{t.label}{t.key !== 'decided' && tabCount(t.key) ? ' ' + tabCount(t.key) : ''}</Button>
          ))}
        </Stack>
        {!fixedSub && (
          <Stack direction="row" gap={0.75} sx={{ px: 2, py: 1, overflowX: 'auto', scrollbarWidth: 'none', '&::-webkit-scrollbar': { display: 'none' } }} aria-label="艦で絞り込む">
            {[{ id: '', name: 'すべて' }, ...subsWithItems].map((s) => {
              const active = sub === s.id;
              const n = s.id && tab !== 'decided' ? counts[s.id]?.[tab] || 0 : 0;
              return (
                <Button key={s.id || 'all'} size="small" onClick={() => pickSub(s.id)} aria-pressed={active}
                  sx={{
                    flexShrink: 0, minHeight: 30, borderRadius: 999, px: 1.4, fontSize: 13, fontWeight: 700, whiteSpace: 'nowrap',
                    color: active ? 'var(--p-paper, #fff)' : V.ink, background: active ? V.ink : 'transparent', border: '1px solid ' + (active ? V.ink : V.rule),
                    '&:hover': { background: active ? V.ink : 'var(--p-sunken)' },
                  }}>{s.name}{n ? ' ' + n : ''}</Button>
              );
            })}
          </Stack>
        )}
      </Box>

      {items.map((item) => (
        <Post key={item.submarineId + item.id} item={item} now={now} busy={busy} onFeedback={feedback}
          actions={actionsBySub[item.submarineId] || []} />
      ))}
      {loaded && !items.length && !loading && (
        <Typography sx={{ fontSize: 14, color: V.muted, textAlign: 'center', py: 6 }}>
          {tab === 'candidate' ? '評価待ちはありません。' : tab === 'confirmed' ? '採用済みの成果はありません。' : 'まだありません。'}
        </Typography>
      )}
      <Box ref={sentinel} sx={{ display: 'grid', placeItems: 'center', py: 2, minHeight: 40 }}>
        {loading ? <CircularProgress size={22} /> : cursor ? <Button size="small" onClick={() => load(false, cursor)} sx={{ color: V.muted }}>さらに読み込む</Button> : null}
      </Box>
    </Box>
  );
}
