import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Alert, Box, Button, CircularProgress, Collapse, Link, Stack, Tab, Tabs, Typography,
} from '@mui/material';
import { ArrowBack, Refresh } from '@mui/icons-material';
import { marked } from 'marked';
import { auth } from '../firebase';
import HaulTimeline from './HaulTimeline';

// Project Submarine. Each submarine is an exploration job: a mission (what to find), gear (skills/packs at the
// version their スキル錬成道場 released), a logbook of sorties and the haul it brought back. Discover and 仕事DB
// live here only: their recommendations and listings are the haul of SS-01 and SS-02. The page opens on the
// whole fleet's haul, so everything waiting for the user is evaluated in one place.

const V = {
  ink: 'var(--p-ink)', muted: 'var(--p-muted)', faint: 'var(--p-faint)', rule: 'var(--p-rule)',
  accent: 'var(--p-accent)', accentSoft: 'var(--p-accent-soft)', amber: 'var(--p-amber)',
  blue: 'var(--p-blue)', green: 'var(--p-green)', pink: 'var(--p-pink)',
};
// The sea, the hulls and the plates keep their own palette in light and dark themes.
const SEA = {
  deep: '#06141d', mid: '#0b2533', line: 'rgba(120, 220, 230, 0.18)', glow: '#62e6d8', text: '#cdeff2',
  dim: 'rgba(205, 239, 242, 0.62)', amber: '#f6c25b', pink: '#ff8a9a', green: '#7ee0a1', grey: '#7d93a0',
  hullTop: '#2b5d70', hullBottom: '#10313f',
};
const MONO = '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace';

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
const gearName = (g) => (g.kind === 'intelligence_pack' ? 'Pack ' : '') + g.id;

// One lamp per submarine: where it is and whether it needs the user.
export function lampOf(sub) {
  if (sub.status === 'decommissioned') return { label: '退役', color: SEA.grey, text: '退役しています' };
  if (sub.status === 'paused') return { label: '停泊', color: SEA.grey, text: '休止中です' };
  if (sub.openSortieId) return { label: '潜航中', color: SEA.glow, pulse: true, text: 'いま出航しています（' + sub.openSortieId + '）' };
  if (sub.candidateCount > 0) return { label: '評価待ち', color: SEA.amber, text: '持ち帰った成果 ' + sub.candidateCount + ' 件があなたの評価を待っています' };
  if (sub.stalledSorties >= 3) return { label: '要点検', color: SEA.pink, text: sub.stalledSorties + ' 回続けて何も持ち帰っていません。任務か装備の見直しが必要です' };
  if (!sub.sortieCount) return { label: '出航前', color: SEA.dim, text: 'まだ一度も出航していません' };
  const last = sub.lastSortie;
  return {
    label: '帰港', color: last?.moved === false ? SEA.amber : SEA.green,
    text: '最後の出航は ' + shortDate(last?.finishedAt) + '（' + (last?.moved === false ? '空振り' : (last?.haulCount ? '成果 ' + last.haulCount + ' 件' : '海図・練習のみ')) + '）',
  };
}

function Lamp({ lamp, size = 9 }) {
  return (
    <Box component="span" aria-hidden sx={{
      display: 'inline-block', width: size, height: size, borderRadius: '50%', background: lamp.color, flexShrink: 0,
      boxShadow: '0 0 0 3px ' + lamp.color + '22, 0 0 10px ' + lamp.color + '88',
      ...(lamp.pulse ? { animation: 'subPulse 1.6s ease-in-out infinite', '@media (prefers-reduced-motion: reduce)': { animation: 'none' } } : {}),
      '@keyframes subPulse': { '0%,100%': { opacity: 1 }, '50%': { opacity: 0.35 } },
    }} />
  );
}

function HullPlate({ hull, dark = false }) {
  if (!hull) return null;
  return (
    <Box component="span" sx={{
      fontFamily: MONO, fontSize: 11.5, fontWeight: 800, letterSpacing: '0.08em', px: 0.8, py: 0.15, borderRadius: 0.5,
      border: '1px solid ' + (dark ? SEA.line : V.rule), color: dark ? SEA.glow : V.muted, background: dark ? 'rgba(98,230,216,0.06)' : 'transparent', whiteSpace: 'nowrap',
    }}>{hull}</Box>
  );
}

// ---- The submarine itself ------------------------------------------------------

// Side view of a submarine: the hull number on the sail, the status lamp on the periscope, one lit porthole per
// gear (amber for the primary gear), and bubbles from the screw while it is at sea.
export function SubmarineHull({ hull, lamp, gear = [], atSea = false, idKey = 'sub' }) {
  const ports = Math.min(Math.max(gear.length, 1), 6);
  const portX = (i) => 220 - i * 26;
  return (
    <Box component="svg" viewBox="0 0 320 112" role="img" aria-label={(hull || '潜水艦') + '：' + lamp.label} sx={{ width: '100%', height: 'auto', display: 'block' }}>
      <defs>
        <linearGradient id={idKey + '-hull'} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={SEA.hullTop} />
          <stop offset="1" stopColor={SEA.hullBottom} />
        </linearGradient>
        <radialGradient id={idKey + '-port'}>
          <stop offset="0" stopColor="#fff3c4" />
          <stop offset="1" stopColor={SEA.amber} />
        </radialGradient>
      </defs>
      <path d="M40 0 L70 0 L30 112 L10 112 Z M150 0 L170 0 L150 112 L120 112 Z" fill="rgba(140,230,240,0.04)" />
      <path d="M22 70 L4 52 L10 52 L30 64 Z" fill={SEA.hullBottom} />
      <path d="M22 70 L4 88 L10 88 L30 76 Z" fill={SEA.hullBottom} />
      <ellipse cx="13" cy="70" rx="3" ry="11" fill="#5d8796" opacity="0.8" />
      <path d="M44 52 H262 C292 52 308 62 308 70 C308 78 292 88 262 88 H44 C30 88 20 80 20 70 C20 60 30 52 44 52 Z"
        fill={'url(#' + idKey + '-hull)'} stroke="rgba(160,230,240,0.35)" strokeWidth="0.8" />
      <path d="M36 61 H280" stroke="rgba(200,245,250,0.14)" strokeWidth="1" />
      <path d="M122 53 L128 30 Q130 26 135 26 H174 Q179 26 180 30 L186 53 Z" fill={'url(#' + idKey + '-hull)'} stroke="rgba(160,230,240,0.35)" strokeWidth="0.8" />
      <path d="M128 40 L114 40 L116 37 L129 37 Z M180 40 L194 40 L192 37 L179 37 Z" fill={SEA.hullBottom} />
      <text x="154" y="45" textAnchor="middle" fontFamily={MONO} fontSize="11" fontWeight="800" fill={SEA.text} letterSpacing="1">{hull || ''}</text>
      <path d="M168 26 V9 H177" stroke="#7fa6b2" strokeWidth="2.2" fill="none" strokeLinecap="round" />
      <circle cx="179" cy="9" r="3.6" fill={lamp.color}>
        {lamp.pulse && <animate attributeName="opacity" values="1;0.3;1" dur="1.6s" repeatCount="indefinite" />}
      </circle>
      {Array.from({ length: ports }, (_, i) => {
        const g = gear[i];
        return (
          <g key={i}>
            <circle cx={portX(i)} cy="72" r="6.2" fill="#0a2230" stroke="rgba(170,230,240,0.45)" strokeWidth="1.2" />
            {g && <circle cx={portX(i)} cy="72" r="4" fill={g.role === 'primary' ? 'url(#' + idKey + '-port)' : '#9fd8e0'} opacity={g.error ? 0.3 : 0.95} />}
          </g>
        );
      })}
      <circle cx="300" cy="70" r="1.8" fill={SEA.glow} opacity="0.7" />
      {atSea && [0, 1, 2].map((i) => (
        <circle key={i} cx={8 + i * 5} cy="70" r={1.6 + i * 0.6} fill="none" stroke="rgba(200,245,250,0.6)" strokeWidth="0.8">
          <animate attributeName="cy" values="72;10" dur={(2.2 + i * 0.5) + 's'} begin={(i * 0.6) + 's'} repeatCount="indefinite" />
          <animate attributeName="opacity" values="0.9;0" dur={(2.2 + i * 0.5) + 's'} begin={(i * 0.6) + 's'} repeatCount="indefinite" />
        </circle>
      ))}
      <path d="M0 106 Q40 100 80 105 T160 104 T240 106 T320 103 V112 H0 Z" fill="rgba(120,200,210,0.08)" />
    </Box>
  );
}

// Depth gauge: confirmed haul against the mission target, drawn as a ruler.
function DepthGauge({ confirmed, target, dark = false }) {
  const goal = Math.max(Number(target?.min) || 1, 1);
  const ratio = Math.min(confirmed / goal, 1);
  const ticks = Math.min(goal, 12);
  return (
    <Box sx={{ minWidth: 0 }}>
      <Stack direction="row" justifyContent="space-between" alignItems="baseline">
        <Typography sx={{ fontSize: 11, color: dark ? SEA.dim : V.muted, letterSpacing: '0.04em' }}>確定した成果</Typography>
        <Typography sx={{ fontFamily: MONO, fontSize: 13, fontWeight: 800, color: dark ? SEA.text : V.ink }}>
          {confirmed}<span style={{ opacity: 0.6 }}> / {targetText(target)}</span>
        </Typography>
      </Stack>
      <Box role="meter" aria-valuemin={0} aria-valuemax={goal} aria-valuenow={confirmed} aria-label="確定した成果"
        sx={{ position: 'relative', height: 8, mt: 0.5, borderRadius: 4, background: dark ? 'rgba(205,239,242,0.08)' : 'var(--p-sunken)', overflow: 'hidden' }}>
        <Box sx={{ position: 'absolute', inset: 0, width: (ratio * 100) + '%', background: 'linear-gradient(90deg, #2bb5c4, ' + SEA.glow + ')', borderRadius: 4, transition: 'width .4s' }} />
        {Array.from({ length: ticks - 1 }, (_, i) => (
          <Box key={i} sx={{ position: 'absolute', top: 0, bottom: 0, left: ((i + 1) / ticks * 100) + '%', width: '1px', background: dark ? 'rgba(6,20,29,0.7)' : 'var(--p-paper, #fff)' }} />
        ))}
      </Box>
    </Box>
  );
}

// ---- Sonar deck --------------------------------------------------------------

function blipPosition(index, count, sub) {
  const angle = (-90 + (360 / Math.max(count, 1)) * index + 18) * Math.PI / 180;
  const goal = Math.max(Number(sub.mission?.target?.min) || 1, 1);
  const progress = Math.min((sub.confirmedCount || 0) / goal, 1);
  const r = 0.86 - progress * 0.52; // closer to the center as the mission fills
  return { x: 50 + Math.cos(angle) * r * 46, y: 50 + Math.sin(angle) * r * 46 };
}

function SonarDeck({ fleet, onOpen }) {
  const atSea = fleet.filter((s) => s.openSortieId).length;
  const waiting = fleet.reduce((sum, s) => sum + (s.candidateCount || 0), 0);
  const confirmed = fleet.reduce((sum, s) => sum + (s.confirmedCount || 0), 0);
  const readouts = [
    { label: '就役', value: fleet.length, unit: '隻' },
    { label: '潜航中', value: atSea, unit: '隻', color: atSea ? SEA.glow : undefined },
    { label: '評価待ちの成果', value: waiting, unit: '件', color: waiting ? SEA.amber : undefined },
    { label: '確定した成果', value: confirmed, unit: '件' },
  ];
  return (
    <Box sx={{
      mt: 2.5, borderRadius: 2, overflow: 'hidden', color: SEA.text, position: 'relative',
      background: 'radial-gradient(120% 140% at 15% 0%, ' + SEA.mid + ' 0%, ' + SEA.deep + ' 62%)', border: '1px solid #0f3446',
      display: 'grid', gridTemplateColumns: { xs: '1fr', md: '300px minmax(0,1fr)' }, alignItems: 'center',
    }}>
      <Box sx={{ position: 'relative', width: '100%', maxWidth: 300, aspectRatio: '1 / 1', mx: 'auto', p: 2 }}>
        <Box component="svg" viewBox="0 0 100 100" sx={{ width: '100%', height: '100%', display: 'block' }} aria-hidden>
          <defs>
            <radialGradient id="subSweep" cx="50" cy="50" r="46" gradientUnits="userSpaceOnUse">
              <stop offset="0" stopColor={SEA.glow} stopOpacity="0.45" />
              <stop offset="1" stopColor={SEA.glow} stopOpacity="0" />
            </radialGradient>
          </defs>
          {[46, 34.5, 23, 11.5].map((r) => <circle key={r} cx="50" cy="50" r={r} fill="none" stroke={SEA.line} strokeWidth="0.4" />)}
          <line x1="4" y1="50" x2="96" y2="50" stroke={SEA.line} strokeWidth="0.3" />
          <line x1="50" y1="4" x2="50" y2="96" stroke={SEA.line} strokeWidth="0.3" />
          <Box component="g" sx={{
            transformOrigin: '50px 50px', animation: 'subSweep 6s linear infinite',
            '@keyframes subSweep': { from: { transform: 'rotate(0deg)' }, to: { transform: 'rotate(360deg)' } },
            '@media (prefers-reduced-motion: reduce)': { animation: 'none' },
          }}>
            <path d="M50 50 L50 4 A46 46 0 0 1 82.5 17.5 Z" fill="url(#subSweep)" />
          </Box>
          <circle cx="50" cy="50" r="1.2" fill={SEA.glow} />
        </Box>
        <Box sx={{ position: 'absolute', inset: 16 }}>
          {fleet.map((sub, index) => {
            const { x, y } = blipPosition(index, fleet.length, sub);
            const lamp = lampOf(sub);
            return (
              <Box key={sub.id} component="button" type="button" onClick={() => onOpen(sub.id)} title={(sub.hull ? sub.hull + ' ' : '') + sub.name + '：' + lamp.label}
                sx={{
                  all: 'unset', cursor: 'pointer', position: 'absolute', left: x + '%', top: y + '%',
                  transform: 'translate(-50%, -50%)', display: 'flex', alignItems: 'center', gap: 0.6,
                  '&:focus-visible': { outline: '1px solid ' + SEA.glow, outlineOffset: 3, borderRadius: 1 },
                }}>
                <Lamp lamp={lamp} size={8} />
                <Typography component="span" sx={{ fontFamily: MONO, fontSize: 10, color: SEA.dim, whiteSpace: 'nowrap' }}>{sub.hull || sub.name}</Typography>
              </Box>
            );
          })}
        </Box>
      </Box>
      <Box sx={{ p: { xs: 2.5, md: 3 }, pt: { xs: 0, md: 3 } }}>
        <Typography sx={{ fontFamily: MONO, fontSize: 11, letterSpacing: '0.18em', color: SEA.glow }}>SONAR · FLEET STATUS</Typography>
        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0,1fr))', gap: 1.5, mt: 1.5 }}>
          {readouts.map((r) => (
            <Box key={r.label} sx={{ borderTop: '1px solid ' + SEA.line, pt: 1 }}>
              <Typography sx={{ fontSize: 11.5, color: SEA.dim }}>{r.label}</Typography>
              <Typography sx={{ fontFamily: MONO, fontSize: 26, fontWeight: 800, color: r.color || SEA.text, lineHeight: 1.2 }}>
                {r.value}<span style={{ fontSize: 12, opacity: 0.6, marginLeft: 4 }}>{r.unit}</span>
              </Typography>
            </Box>
          ))}
        </Box>
        <Typography sx={{ fontSize: 12.5, color: SEA.dim, mt: 2, lineHeight: 1.7 }}>
          中心に近い艦ほど、任務の目標に近づいています。点を押すとその艦を開きます。
        </Typography>
      </Box>
    </Box>
  );
}

// ---- Fleet cards -------------------------------------------------------------

function GearChips({ gear, onDojo, dark = false }) {
  return (
    <Stack direction="row" gap={0.6} flexWrap="wrap">
      {(gear || []).map((g) => (
        <Box key={g.kind + g.id} component={g.dojoId ? 'button' : 'span'} type={g.dojoId ? 'button' : undefined}
          onClick={g.dojoId ? (event) => { event.stopPropagation(); onDojo(g.dojoId); } : undefined}
          title={g.dojoId ? '道場 ' + g.dojoId + ' が合格させた版' : '版を固定した装備（道場なし）'}
          sx={{
            all: 'unset', cursor: g.dojoId ? 'pointer' : 'default', fontFamily: MONO, fontSize: 11, px: 0.8, py: 0.2, borderRadius: 0.75,
            border: '1px solid ' + (g.error ? V.pink : dark ? SEA.line : V.rule),
            color: g.error ? V.pink : dark ? SEA.text : V.ink, background: g.role === 'primary' ? (dark ? 'rgba(98,230,216,0.08)' : V.accentSoft) : 'transparent',
            '&:hover': g.dojoId ? { borderColor: dark ? SEA.glow : V.accent } : {},
          }}>
          {gearName(g)}{g.version ? ' v' + g.version : ''}{g.dojoId ? ' ⚓' : ''}
        </Box>
      ))}
    </Stack>
  );
}

function FleetCard({ sub, onOpen, onDojo }) {
  const lamp = lampOf(sub);
  return (
    <Box component="article" onClick={() => onOpen(sub.id)} tabIndex={0} role="button" aria-label={(sub.hull ? sub.hull + ' ' : '') + sub.name}
      onKeyDown={(event) => { if (event.key === 'Enter') onOpen(sub.id); }}
      sx={{
        cursor: 'pointer', borderRadius: 2, overflow: 'hidden', display: 'flex', flexDirection: 'column',
        border: '1px solid #0f3446', background: 'var(--p-paper, transparent)', transition: 'transform .15s, box-shadow .15s',
        '&:hover, &:focus-visible': { transform: 'translateY(-2px)', boxShadow: '0 10px 24px rgba(6,20,29,0.25)', outline: 'none' },
        '@media (prefers-reduced-motion: reduce)': { transition: 'none', '&:hover': { transform: 'none' } },
      }}>
      <Box sx={{ position: 'relative', background: 'linear-gradient(180deg, ' + SEA.mid + ' 0%, ' + SEA.deep + ' 100%)', px: 1.5, pt: 1.2 }}>
        <Stack direction="row" alignItems="center" justifyContent="space-between">
          <Typography sx={{ fontFamily: MONO, fontSize: 10.5, letterSpacing: '0.16em', color: SEA.dim }}>
            {sub.mode === 'one_shot' ? 'ON CALL' : 'PATROL'}
          </Typography>
          <Stack direction="row" alignItems="center" gap={0.7}>
            <Lamp lamp={lamp} size={7} />
            <Typography sx={{ fontSize: 11.5, fontWeight: 800, color: lamp.color }}>{lamp.label}</Typography>
          </Stack>
        </Stack>
        <SubmarineHull hull={sub.hull} lamp={lamp} gear={sub.loadout} atSea={Boolean(sub.openSortieId)} idKey={'card-' + sub.id} />
      </Box>
      <Box sx={{ p: 2, display: 'flex', flexDirection: 'column', gap: 1.1, flex: 1, borderTop: '2px solid ' + lamp.color }}>
        <Typography component="h3" sx={{ fontSize: 18, fontWeight: 850, letterSpacing: '-0.01em' }}>{sub.name}</Typography>
        <Typography sx={{ fontSize: 13.5, color: V.muted, lineHeight: 1.6, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
          {sub.mission?.statement}
        </Typography>
        <GearChips gear={sub.loadout} onDojo={onDojo} />
        <DepthGauge confirmed={sub.confirmedCount || 0} target={sub.mission?.target} />
        <Typography sx={{ fontSize: 12, color: V.muted }}>{lamp.text}</Typography>
      </Box>
    </Box>
  );
}

// ---- Haul -------------------------------------------------------------------

function MarkdownBody({ source }) {
  const html = marked.parse(String(source || '').replace(/&/g, '&amp;').replace(/</g, '&lt;'), { async: false });
  return (
    <Box dangerouslySetInnerHTML={{ __html: html }} sx={{
      fontSize: 13.5, lineHeight: 1.75, color: V.ink, overflowWrap: 'anywhere',
      '& h1': { fontSize: 17, fontWeight: 850, mt: 2, mb: 1 }, '& h2': { fontSize: 15, fontWeight: 800, mt: 2.5, mb: 1 },
      '& h3': { fontSize: 14, fontWeight: 800, mt: 2, mb: 0.6 }, '& p': { my: 1 }, '& ul, & ol': { pl: 3, my: 1 },
      '& code': { fontFamily: MONO, fontSize: 12.5, background: 'var(--p-sunken)', px: 0.5, borderRadius: 0.5 },
      '& table': { display: 'block', overflowX: 'auto', borderCollapse: 'collapse', my: 1.5, fontSize: 13 },
      '& th, & td': { border: '1px solid ' + V.rule, px: 1.2, py: 0.7, textAlign: 'left', verticalAlign: 'top' },
    }} />
  );
}
const Small = ({ children }) => <Typography component="span" sx={{ fontSize: 11.5, color: V.faint }}>{children}</Typography>;
const Quiet = ({ children }) => <Typography sx={{ fontSize: 13.5, color: V.muted, py: 1 }}>{children}</Typography>;

// ---- Console (detail) ----------------------------------------------------------

function Row({ label, children }) {
  if (children === null || children === undefined || children === '' || (Array.isArray(children) && !children.length)) return null;
  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '128px minmax(0,1fr)' }, columnGap: 2, py: 1, borderBottom: '1px solid ' + V.rule }}>
      <Typography sx={{ fontSize: 12.5, color: V.muted }}>{label}</Typography>
      <Box sx={{ fontSize: 13.5, lineHeight: 1.65, minWidth: 0, overflowWrap: 'anywhere' }}>{children}</Box>
    </Box>
  );
}

function GearPanel({ gear, onDojo }) {
  const [open, setOpen] = useState(false);
  return (
    <Box sx={{ border: '1px solid ' + (gear.error ? V.pink : V.rule), borderRadius: 1.5, p: 1.8, mb: 1.5 }}>
      <Stack direction="row" gap={1} alignItems="baseline" flexWrap="wrap">
        <Typography component="span" sx={{ fontFamily: MONO, fontSize: 11, fontWeight: 800, color: gear.role === 'primary' ? V.accent : V.muted }}>
          {gear.role === 'primary' ? '主装備' : '補助装備'}
        </Typography>
        <Typography sx={{ fontSize: 15, fontWeight: 800 }}>{gear.title || gearName(gear)}</Typography>
        <Typography component="span" sx={{ fontFamily: MONO, fontSize: 12.5, fontWeight: 800 }}>v{gear.version || '?'}</Typography>
      </Stack>
      <Typography sx={{ fontSize: 12.5, color: V.muted, mt: 0.4, lineHeight: 1.6 }}>
        {gear.kind === 'intelligence_pack' ? 'Pack' : 'スキル'} {gear.id}
        {gear.versionFrom === 'dojo'
          ? <>　版は道場 <Link component="button" type="button" onClick={() => onDojo(gear.dojoId)} sx={{ fontSize: 12.5, verticalAlign: 'baseline' }}>{gear.dojoTitle || gear.dojoId}</Link> が決めています{gear.train ? '。出航ごとに練習として記録されます' : ''}</>
          : '　道場なし（版を固定）'}
      </Typography>
      {gear.use && <Typography sx={{ fontSize: 13, mt: 0.5 }}>用途：{gear.use}</Typography>}
      {gear.unreleasedNewer && <Typography sx={{ fontSize: 12.5, color: V.amber, mt: 0.5 }}>v{gear.latestVersion} は道場をまだ通っていないので、この艦は v{gear.version} を積んだままです。</Typography>}
      {gear.error && <Typography sx={{ fontSize: 12.5, color: V.pink, mt: 0.5 }}>{gear.error}</Typography>}
      {gear.body && (
        <>
          <Button size="small" onClick={() => setOpen((v) => !v)} sx={{ px: 0, minWidth: 0, fontSize: 12, color: V.faint, mt: 0.5 }}>{open ? '本文を閉じる' : '本文を見る'}</Button>
          <Collapse in={open} unmountOnExit><Box sx={{ mt: 1, pt: 1, borderTop: '1px dashed ' + V.rule }}><MarkdownBody source={gear.body} /></Box></Collapse>
        </>
      )}
    </Box>
  );
}

function Sortie({ sortie }) {
  const stalled = sortie.status === 'finished' && sortie.moved === false;
  const state = sortie.status === 'open' ? { label: '潜航中', color: V.blue } : stalled ? { label: '空振り', color: V.pink }
    : sortie.status === 'abandoned' ? { label: '中断', color: V.faint } : { label: '帰港', color: V.green };
  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: '64px minmax(0,1fr)', columnGap: 1.5, py: 1.2, borderBottom: '1px solid ' + V.rule }}>
      <Box>
        <Typography sx={{ fontFamily: MONO, fontSize: 12, fontWeight: 800 }}>{sortie.id}</Typography>
        <Small>{shortDate(sortie.startedAt)}</Small>
      </Box>
      <Box sx={{ minWidth: 0 }}>
        <Stack direction="row" gap={1} alignItems="baseline" flexWrap="wrap">
          <Typography component="span" sx={{ fontSize: 12, fontWeight: 800, color: state.color }}>{state.label}</Typography>
          <Typography sx={{ fontSize: 14, fontWeight: 700 }}>{sortie.objective}</Typography>
        </Stack>
        {(sortie.summary || sortie.notMovedReason) && <Typography sx={{ fontSize: 13, color: V.muted, mt: 0.3, lineHeight: 1.6 }}>{sortie.summary || sortie.notMovedReason}</Typography>}
        <Typography sx={{ fontSize: 12, color: V.faint, mt: 0.3 }}>
          {(sortie.loadout || []).map((g) => gearName(g) + ' v' + g.version).join('、')}
          {sortie.status === 'finished' && '　成果 ' + (sortie.haulIds || []).length + ' 件'}
          {(sortie.chartIds || []).length > 0 && '　海図 ' + sortie.chartIds.length + ' 件'}
          {(sortie.dojoRuns || []).length > 0 && '　道場の練習 ' + sortie.dojoRuns.map((r) => r.dojoId + ' ' + r.runId).join('、')}
        </Typography>
        {sortie.nextStep && <Typography sx={{ fontSize: 12, color: V.muted, mt: 0.3 }}>次の出航：{sortie.nextStep}</Typography>}
      </Box>
    </Box>
  );
}

function Schedule({ schedule }) {
  const jobs = schedule?.jobs || [];
  if (!jobs.length) return <Typography sx={{ fontSize: 13.5, color: V.muted, py: 1 }}>定期出航はありません。頼まれたときに出航します。</Typography>;
  return jobs.map((job) => (
    <Box key={job.id} sx={{ py: 1, borderBottom: '1px solid ' + V.rule }}>
      <Stack direction="row" gap={1} alignItems="baseline" flexWrap="wrap">
        <Typography sx={{ fontSize: 14, fontWeight: 800 }}>{job.title}</Typography>
        <Small>{job.id}　{job.status === 'active' ? '稼働中' : '停止中'}</Small>
      </Stack>
      <Typography sx={{ fontFamily: MONO, fontSize: 13, mt: 0.3 }}>{(job.slots || []).join('  ')} <Small>JST</Small></Typography>
      {(job.lastRuns || []).slice(0, 3).map((run) => (
        <Typography key={run.id} sx={{ fontSize: 12, color: V.muted, mt: 0.2 }}>
          {shortDate(run.startedAt)} {run.status === 'completed' ? '完了' : run.status === 'failed' ? '失敗' : '実行中'}{run.summary ? '：' + run.summary.slice(0, 120) : ''}
        </Typography>
      ))}
    </Box>
  ));
}

const CONSOLE_TABS = [
  { key: 'haul', label: '成果' }, { key: 'mission', label: '任務' }, { key: 'gear', label: '装備' },
  { key: 'log', label: '航海日誌' }, { key: 'chart', label: '海図' },
];
function Console({ detail, onDojo, onNotice, onError }) {
  const [tab, setTab] = useState('haul');
  const { submarine: sub, mission = {}, loadout = [], haul = {}, chart = [], position = {}, full = {}, warnings = [] } = detail;
  const awaiting = haul.awaiting || [];
  const where = sub.haulCanonical?.where || 'here';
  const lamp = lampOf({ ...sub, openSortieId: position.openSortieId, candidateCount: awaiting.length, stalledSorties: position.stalledSorties, sortieCount: position.sortieCount, lastSortie: (position.lastSorties || [])[0] });
  const sorties = full.sorties || [];
  const slots = (full.schedule?.jobs || []).filter((j) => j.status === 'active').flatMap((j) => j.slots || []);

  return (
    <Box>
      <Box sx={{
        borderRadius: 2, overflow: 'hidden', color: SEA.text, border: '1px solid #0f3446',
        background: 'linear-gradient(135deg, ' + SEA.mid + ' 0%, ' + SEA.deep + ' 70%)',
        display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'minmax(0,1fr) 340px' }, alignItems: 'center',
      }}>
        <Box sx={{ p: { xs: 2.2, md: 2.8 } }}>
          <Stack direction="row" alignItems="center" gap={1.2} flexWrap="wrap">
            <HullPlate hull={sub.hull} dark />
            <Stack direction="row" alignItems="center" gap={0.7}>
              <Lamp lamp={lamp} />
              <Typography sx={{ fontSize: 12.5, fontWeight: 800, color: lamp.color }}>{lamp.label}</Typography>
            </Stack>
          </Stack>
          <Typography component="h1" sx={{ fontSize: { xs: 24, md: 28 }, fontWeight: 900, letterSpacing: '-0.02em', mt: 1, lineHeight: 1.25 }}>{sub.name}</Typography>
          <Typography sx={{ fontSize: 14, color: SEA.dim, mt: 0.6, lineHeight: 1.7 }}>{sub.summary}</Typography>
          <Typography sx={{ fontSize: 13, mt: 1.2, lineHeight: 1.6 }}>{lamp.text}</Typography>
          {(slots.length > 0 || sub.mode === 'one_shot') && (
            <Typography sx={{ fontFamily: MONO, fontSize: 11.5, color: SEA.dim, mt: 0.6 }}>
              {slots.length ? '定期出航 ' + slots.join(' ') + ' JST' : '頼まれたときに出航'}
            </Typography>
          )}
          <Box sx={{ mt: 1.2 }}><GearChips gear={loadout} onDojo={onDojo} dark /></Box>
          <Box sx={{ mt: 1.8, maxWidth: 420 }}><DepthGauge confirmed={mission.confirmedCount || 0} target={mission.target} dark /></Box>
        </Box>
        <Box sx={{ px: 2, pb: { xs: 2, md: 0 }, display: { xs: 'none', sm: 'block' } }}>
          <SubmarineHull hull={sub.hull} lamp={lamp} gear={loadout} atSea={Boolean(position.openSortieId)} idKey={'console-' + sub.id} />
        </Box>
      </Box>

      {warnings.filter((w) => !/wait for the user/.test(w)).map((w) => <Alert key={w} severity="warning" sx={{ mt: 1.5, fontSize: 13 }}>{w}</Alert>)}

      <Tabs value={tab} onChange={(_, value) => setTab(value)} variant="scrollable" allowScrollButtonsMobile
        sx={{ mt: 2.5, borderBottom: '1px solid ' + V.rule, minHeight: 42, '& .MuiTab-root': { minHeight: 42, fontSize: 13.5, fontWeight: 700 } }}>
        {CONSOLE_TABS.map((item) => {
          const count = { haul: awaiting.length, gear: loadout.length, log: sorties.length, chart: chart.length }[item.key];
          return <Tab key={item.key} value={item.key} label={item.label + (count ? ' ' + count : '')} />;
        })}
      </Tabs>
      <Box sx={{ pt: 2.5 }}>
        {tab === 'haul' && <HaulTimeline fixedSub={sub.id} onNotice={onNotice} onError={onError} />}

        {tab === 'mission' && (<>
          <Typography sx={{ fontSize: 15.5, fontWeight: 750, lineHeight: 1.7 }}>{mission.statement}</Typography>
          {mission.acceptance && <Typography sx={{ fontSize: 14, lineHeight: 1.85, mt: 1, whiteSpace: 'pre-line' }}>{mission.acceptance}</Typography>}
          <Box sx={{ mt: 1.5 }}>
            <Row label="成果1件の単位">{mission.unit}</Row>
            <Row label="目標">{targetText(mission.target)} 件</Row>
            <Row label="その先に見る指標">{mission.finalIndicator}</Row>
            <Row label="成果に数えないもの">{(mission.proxies || []).join('、')}</Row>
            <Row label="止める条件">{(mission.stopConditions || []).map((t) => <Box key={t}>{t}</Box>)}</Row>
            <Row label="期限">{mission.deadline || 'なし'}</Row>
            <Row label="成果の置き場">{where !== 'here' ? where + (sub.haulCanonical?.note ? '（' + sub.haulCanonical.note + '）' : '') : 'この潜水艦'}</Row>
          </Box>
          <Typography sx={{ fontSize: 13, fontWeight: 800, mt: 3, pb: 0.6, borderBottom: '1px solid ' + V.rule }}>定期出航</Typography>
          <Schedule schedule={full.schedule} />
          <Typography sx={{ fontSize: 12, color: V.faint, mt: 1.5 }}>任務はあなたが決めるものです。変えたいときはチャットで伝えてください。</Typography>
        </>)}

        {tab === 'gear' && (<>
          <Typography sx={{ fontSize: 12.5, color: V.muted, mb: 1.5, lineHeight: 1.65 }}>
            積んでいるスキルとPackです。道場で鍛えている装備は、その道場が合格させた版を積みます。道場で版が上がると、次の出航から新しい版に替わります。
          </Typography>
          {loadout.map((g) => <GearPanel key={g.kind + g.id} gear={g} onDojo={onDojo} />)}
        </>)}

        {tab === 'log' && (<>
          {sorties.map((s) => <Sortie key={s.id} sortie={s} />)}
          {!sorties.length && <Quiet>まだ出航していません。</Quiet>}
        </>)}

        {tab === 'chart' && (<>
          <Typography sx={{ fontSize: 12.5, color: V.muted, mb: 1, lineHeight: 1.65 }}>
            探している対象について分かったことです。探し方（情報源・手順）についての知見は、装備の道場に記録されます。
          </Typography>
          {chart.map((entry) => (
            <Box key={entry.id} sx={{ py: 1.1, borderBottom: '1px solid ' + V.rule }}>
              <Stack direction="row" gap={1} alignItems="baseline"><Typography sx={{ fontFamily: MONO, fontSize: 11.5, color: V.faint }}>{entry.id}</Typography><Typography sx={{ fontSize: 14, fontWeight: 700, lineHeight: 1.6 }}>{entry.statement}</Typography></Stack>
              <Typography sx={{ fontSize: 12.5, color: V.muted, mt: 0.3, lineHeight: 1.6 }}>根拠：{entry.basis}{entry.limits ? '　限界：' + entry.limits : ''}</Typography>
            </Box>
          ))}
          {!chart.length && <Quiet>海図はまだ白紙です。</Quiet>}
        </>)}
      </Box>
    </Box>
  );
}

// ---- Page --------------------------------------------------------------------

export default function Submarines() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const selectedId = params.get('id') || '';
  const view = params.get('view') === 'fleet' ? 'fleet' : 'haul';
  const subFilter = params.get('sub') || '';
  const [fleet, setFleet] = useState([]);
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const loadFleet = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api('?resource=submarines');
      setFleet(Array.isArray(data.items) ? data.items : []);
    } catch (err) { setError('艦隊を読み込めません: ' + err.message); } finally { setLoading(false); }
  }, []);
  const loadDetail = useCallback(async (id) => {
    if (!id) { setDetail(null); return; }
    setDetailLoading(true); setError('');
    try { setDetail(await api('?resource=submarine&id=' + encodeURIComponent(id))); } catch (err) { setDetail(null); setError('潜水艦を読み込めません: ' + err.message); } finally { setDetailLoading(false); }
  }, []);

  useEffect(() => { loadFleet(); }, [loadFleet]);
  useEffect(() => { loadDetail(selectedId); }, [loadDetail, selectedId]);
  useEffect(() => { if (!notice) return undefined; const t = setTimeout(() => setNotice(''), 2600); return () => clearTimeout(t); }, [notice]);

  const open = (id) => setParams(id ? { id } : {});
  const setView = (value) => setParams(value === 'fleet' ? { view: 'fleet' } : (subFilter ? { sub: subFilter } : {}));
  const setSubFilter = useCallback((id) => setParams(id ? { sub: id } : {}), [setParams]);
  const openDojo = (dojoId) => navigate('/exploration?id=' + encodeURIComponent(dojoId));
  const active = useMemo(() => fleet.filter((s) => s.status !== 'decommissioned'), [fleet]);
  const retired = useMemo(() => fleet.filter((s) => s.status === 'decommissioned'), [fleet]);
  const showError = useCallback((message) => setError(message), []);
  const showNotice = useCallback((message) => setNotice(message), []);

  return (
    <Box sx={{ maxWidth: selectedId || view === 'fleet' ? 1080 : 640, mx: 'auto', pb: 8 }}>
      <Stack direction="row" justifyContent="space-between" alignItems="center" gap={1} sx={{ mb: 1.5, px: { xs: 0, sm: 1 } }}>
        {selectedId ? (
          <Button startIcon={<ArrowBack />} onClick={() => open('')} sx={{ px: 0, color: V.muted }}>成果に戻る</Button>
        ) : (
          <Typography component="h1" sx={{ fontSize: 20, fontWeight: 900, letterSpacing: '-0.02em' }}>{view === 'fleet' ? '探索の艦隊' : '全艦の成果'}</Typography>
        )}
        <Stack direction="row" gap={0.5}>
          {!selectedId && (
            <Button size="small" onClick={() => setView(view === 'fleet' ? 'haul' : 'fleet')} sx={{ color: V.muted }}>
              {view === 'fleet' ? '成果を見る' : '艦隊を見る'}
            </Button>
          )}
          {(selectedId || view === 'fleet') && (
            <Button size="small" startIcon={<Refresh />} disabled={loading || detailLoading} sx={{ color: V.muted }}
              onClick={() => { loadFleet(); loadDetail(selectedId); }}>再読み込み</Button>
          )}
        </Stack>
      </Stack>

      {error && <Alert severity="error" onClose={() => setError('')} sx={{ mb: 1.5 }}>{error}</Alert>}
      {notice && (
        <Box role="status" sx={{
          position: 'fixed', left: '50%', bottom: { xs: 76, md: 28 }, transform: 'translateX(-50%)', zIndex: 1400,
          background: V.ink, color: 'var(--p-paper, #fff)', borderRadius: 999, px: 2, py: 0.8, fontSize: 13.5, maxWidth: '86vw',
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', boxShadow: '0 6px 18px rgba(0,0,0,0.2)',
        }}>{notice}</Box>
      )}

      {selectedId ? (
        detailLoading && !detail ? <Box sx={{ display: 'grid', placeItems: 'center', py: 7 }}><CircularProgress /></Box>
          : detail ? <Console key={selectedId} detail={detail} onDojo={openDojo} onNotice={showNotice} onError={showError} /> : null
      ) : view === 'haul' ? (
        <HaulTimeline fleet={active} initialSub={subFilter} onSubChange={setSubFilter} onNotice={showNotice} onError={showError} />
      ) : (
        loading && !fleet.length ? <Box sx={{ display: 'grid', placeItems: 'center', py: 7 }}><CircularProgress /></Box> : (<>
          <SonarDeck fleet={active} onOpen={open} />
          <Box sx={{ mt: 2.5, display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(2, minmax(0,1fr))' }, gap: 2 }}>
            {active.map((sub) => <FleetCard key={sub.id} sub={sub} onOpen={open} onDojo={openDojo} />)}
          </Box>
          {!active.length && <Quiet>まだ潜水艦はありません。</Quiet>}
          {retired.length > 0 && <Typography sx={{ fontSize: 12.5, color: V.faint, mt: 2 }}>退役：{retired.map((s) => (s.hull ? s.hull + ' ' : '') + s.name).join('、')}</Typography>}
        </>)
      )}
    </Box>
  );
}
