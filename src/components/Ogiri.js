import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert, Box, Button, Chip, Divider, LinearProgress, Paper, Rating, Stack, TextField,
  ToggleButton, ToggleButtonGroup, Typography, useTheme,
} from '@mui/material';
import {
  AutoAwesome as AutoAwesomeIcon, Bolt as BoltIcon, Refresh as RefreshIcon, Shuffle as ShuffleIcon,
} from '@mui/icons-material';
import {
  collection, doc, getDoc, getDocs, increment, limit, orderBy, query, serverTimestamp, writeBatch,
} from 'firebase/firestore';
import { db } from '../firebase';

const SCHEMA_VERSION = 2;

const SIGNALS = [
  ['unexpected', '意外性'], ['inversion', '逆転'], ['absurd', '不条理'], ['useful', '実用性'],
  ['specific', '具体性'], ['metaphor', '比喩'], ['extreme', '極端化'], ['wordplay', '言葉遊び'],
  ['dark', 'ブラック'], ['cute', 'かわいさ'], ['social', '社会観察'], ['minimal', '引き算'],
];

const LENSES = [
  { id: 'inversion', label: '逆転', prompt: '常識をひっくり返す。立場・目的・因果関係を逆にする。' },
  { id: 'extreme', label: '100倍', prompt: '規模・価格・時間・人数などを100倍にして考える。' },
  { id: 'collision', label: '異業種衝突', prompt: 'まったく別の業界・趣味・制度と混ぜる。' },
  { id: 'removal', label: '引き算', prompt: '当たり前に必要だと思っている要素を1つ捨てる。' },
];

const PREFERENCES = [
  ['original', '元案'],
  ['mutation', '変異案'],
  ['both', '両方'],
  ['neither', 'どちらもボツ'],
];

const FALLBACK_PROMPTS = [
  '「絶対に流行らないのに、なぜか一度だけ試したくなるサービス」を考えてください。',
  '「今まで誰も困っていなかったのに、発売された瞬間に必要になる商品」とは？',
  '「会社員の昼休みを、無駄に壮大なイベントにする方法」は？',
  '「資格試験」をまったく別の娯楽に変えるなら？',
  '「AIが人間より上手くできるのに、人間がやった方が面白いこと」は？',
  '「存在すると少しだけ人生が楽しくなる、どうでもいいデータベース」は？',
  '「面倒くさい」を逆に価値にするサービスを1つ。',
  '「誰も買わないが、見た瞬間に人に話したくなる商品」は？',
  '「SNSでバズること」を目的にしないSNSとは？',
  '「普通のメモ帳」に1機能だけ追加して、別の道具にしてください。',
];

const SOURCE_PROMPTS = [
  'このネタを、まったく別の用途に変えてください。',
  'このネタから「誰も思いつかなそうな商品」を1つ作ってください。',
  'このネタを、くだらない方向へ10倍拡張してください。',
  'このネタと無関係そうなものを1つ衝突させてください。',
];

function randomItem(items) {
  return items[Math.floor(Math.random() * items.length)];
}

function shuffled(items) {
  return [...items].sort(() => Math.random() - 0.5);
}

function clampText(value, max) {
  return String(value || '').trim().slice(0, max);
}

function normalizeSource(item, source) {
  return {
    sourceType: source,
    sourceId: item.id,
    title: clampText(item.title || item.name || item.content, 300),
    text: clampText(item.content || item.summary || item.description, 2000),
    tags: Array.isArray(item.tags) ? item.tags.slice(0, 30).map((tag) => clampText(tag, 120)).filter(Boolean) : [],
  };
}

function isPortalIdea(item = {}) {
  return item?.owner === 'portal'
    || (Boolean(item?.content) && !item?.createdBy && !item?.maturity && !item?.spaceId);
}

function responseTimestamp(item) {
  if (!item?.createdAt) return '';
  try {
    return item.createdAt.toDate().toLocaleDateString('ja-JP');
  } catch {
    return '';
  }
}

export default function Ogiri() {
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';
  const [source, setSource] = useState(null);
  const [prompt, setPrompt] = useState('');
  const [answer, setAnswer] = useState('');
  const [mutation, setMutation] = useState('');
  const [mutationAnswer, setMutationAnswer] = useState('');
  const [signals, setSignals] = useState([]);
  const [selfRating, setSelfRating] = useState(0);
  const [preferredVersion, setPreferredVersion] = useState('');
  const [tasteNote, setTasteNote] = useState('');
  const [sessionRound, setSessionRound] = useState(0);
  const [profile, setProfile] = useState(null);
  const [recentResponses, setRecentResponses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  const loadSnapshot = useCallback(async () => {
    try {
      const [profileSnap, recentSnap] = await Promise.all([
        getDoc(doc(db, 'creative_profile', 'primary')),
        getDocs(query(collection(db, 'ogiri_responses'), orderBy('createdAt', 'desc'), limit(5))),
      ]);
      setProfile(profileSnap.exists() ? profileSnap.data() : null);
      setRecentResponses(recentSnap.docs.map((item) => ({ id: item.id, ...item.data() })));
    } catch {
      // Stats are secondary. The practice flow should remain usable if old data/indexes are inconsistent.
    }
  }, []);

  const pickPortalSeed = useCallback(async () => {
    for (const collectionName of shuffled(['ideas', 'stocks', 'hobbies'])) {
      try {
        let snap;
        try {
          snap = await getDocs(query(collection(db, collectionName), orderBy('createdAt', 'desc'), limit(20)));
        } catch {
          snap = await getDocs(query(collection(db, collectionName), limit(20)));
        }
        const items = snap.docs
          .map((item) => ({ id: item.id, ...item.data() }))
          .filter((item) => collectionName !== 'ideas' || isPortalIdea(item));
        if (items.length) return normalizeSource(randomItem(items), collectionName);
      } catch {
        // Try the next Portal collection before falling back to the static prompt deck.
      }
    }
    return null;
  }, []);

  const resetAnswers = useCallback(() => {
    setAnswer('');
    setMutation('');
    setMutationAnswer('');
    setSignals([]);
    setSelfRating(0);
    setPreferredVersion('');
    setTasteNote('');
    setSubmitted(false);
  }, []);

  const startRound = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const candidate = await pickPortalSeed();
      setSource(candidate);
      setPrompt(candidate ? randomItem(SOURCE_PROMPTS) : randomItem(FALLBACK_PROMPTS));
      resetAnswers();
      setSessionRound((value) => value + 1);
      await loadSnapshot();
    } finally {
      setLoading(false);
    }
  }, [loadSnapshot, pickPortalSeed, resetAnswers]);

  useEffect(() => { startRound(); }, [startRound]);

  const mutationPrompt = useMemo(
    () => LENSES.find((item) => item.id === mutation)?.prompt || '',
    [mutation],
  );

  const topSignals = useMemo(() => Object.entries(profile?.signalCounts || {})
    .filter(([, value]) => Number(value) > 0)
    .sort((a, b) => Number(b[1]) - Number(a[1]))
    .slice(0, 4)
    .map(([id, count]) => ({
      id,
      count: Number(count),
      label: SIGNALS.find(([key]) => key === id)?.[1] || id,
    })), [profile]);

  const averageRating = profile?.totalRounds
    ? (Number(profile.ratingSum || 0) / Number(profile.totalRounds)).toFixed(1)
    : null;

  const toggleSignal = (id) => {
    setSignals((current) => current.includes(id)
      ? current.filter((item) => item !== id)
      : [...current, id]);
  };

  const saveRound = async () => {
    const trimmedAnswer = answer.trim();
    const trimmedMutationAnswer = mutationAnswer.trim();

    if (!trimmedAnswer || !selfRating) return;
    if (trimmedMutationAnswer && !preferredVersion) {
      setError('変異案を書いた場合は、「残すならどっち？」も選んでください。');
      return;
    }

    setSaving(true);
    setError('');
    try {
      const responseRef = doc(collection(db, 'ogiri_responses'));
      const profileRef = doc(db, 'creative_profile', 'primary');
      const batch = writeBatch(db);

      batch.set(responseRef, {
        schemaVersion: SCHEMA_VERSION,
        sessionRound,
        prompt,
        source,
        answer: trimmedAnswer.slice(0, 10000),
        mutation,
        mutationPrompt,
        mutationAnswer: trimmedMutationAnswer.slice(0, 10000),
        signals,
        selfRating,
        preferredVersion: trimmedMutationAnswer ? preferredVersion : 'original',
        tasteNote: tasteNote.trim().slice(0, 1000),
        createdAt: serverTimestamp(),
      });

      const profilePatch = {
        schemaVersion: SCHEMA_VERSION,
        totalRounds: increment(1),
        ratingSum: increment(Number(selfRating)),
        lastResponseId: responseRef.id,
        lastUpdatedAt: serverTimestamp(),
        lastSignals: signals,
      };

      if (signals.length) {
        profilePatch.signalCounts = Object.fromEntries(signals.map((id) => [id, increment(1)]));
      }
      if (trimmedMutationAnswer && mutation) {
        profilePatch.lensCounts = { [mutation]: increment(1) };
      }
      const preferenceKey = trimmedMutationAnswer ? preferredVersion : 'original';
      profilePatch.preferenceCounts = { [preferenceKey]: increment(1) };

      batch.set(profileRef, profilePatch, { merge: true });
      await batch.commit();

      setSubmitted(true);
      setNotice('保存しました。回答と集計は同じトランザクションで記録されています。');
      await loadSnapshot();
    } catch (err) {
      setError(err.message || '保存に失敗しました。');
    } finally {
      setSaving(false);
    }
  };

  const retrySamePrompt = () => {
    resetAnswers();
    setSessionRound((value) => value + 1);
    setNotice('');
  };

  const signalLabels = signals.map((id) => SIGNALS.find(([key]) => key === id)?.[1]).filter(Boolean);
  const canSave = Boolean(answer.trim() && selfRating && (!mutationAnswer.trim() || preferredVersion));

  return (
    <Box sx={{ maxWidth: 980, mx: 'auto', pb: 4 }}>
      <Stack spacing={0.6} sx={{ mb: 2 }}>
        <Stack direction="row" spacing={0.8} alignItems="center">
          <AutoAwesomeIcon color="primary" />
          <Typography variant="overline" color="text.secondary" fontWeight={900} letterSpacing="0.12em">
            O G I R I   L A B
          </Typography>
        </Stack>
        <Typography variant="h4" fontWeight={950}>大喜利で、発想の癖を集める</Typography>
        <Typography color="text.secondary">
          アイデアの完成度ではなく、どこをズラし、どちらを残し、何を自分っぽいと感じたかまで記録します。
          「センス」を早い段階で人格ラベルに固定せず、選択ログとして蓄積します。
        </Typography>
      </Stack>

      {error && <Alert severity="error" sx={{ mb: 1.5 }} onClose={() => setError('')}>{error}</Alert>}
      {notice && <Alert severity="success" sx={{ mb: 1.5 }} onClose={() => setNotice('')}>{notice}</Alert>}
      {loading && <LinearProgress sx={{ mb: 1.5 }} />}

      {profile?.totalRounds > 0 && (
        <Paper elevation={0} variant="outlined" sx={{ mb: 1.5, p: 1.5, borderRadius: 2.5 }}>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.2} justifyContent="space-between">
            <Box>
              <Typography fontWeight={900}>現在の観測値</Typography>
              <Typography variant="body2" color="text.secondary">
                {profile.totalRounds}ラウンド · 自分っぽさ平均 {averageRating}/5
              </Typography>
            </Box>
            <Stack direction="row" flexWrap="wrap" useFlexGap spacing={0.6}>
              {topSignals.map((item) => (
                <Chip key={item.id} size="small" label={`${item.label} ${item.count}`} variant="outlined" />
              ))}
            </Stack>
          </Stack>
        </Paper>
      )}

      <Paper elevation={0} sx={{ p: { xs: 1.5, sm: 2.5 }, border: '1px solid ' + (isDark ? 'rgba(255,255,255,.12)' : 'rgba(40,70,90,.14)'), borderRadius: 3 }}>
        <Stack spacing={2}>
          <Stack direction="row" justifyContent="space-between" alignItems="center">
            <Chip label={'SESSION ' + (sessionRound || '—')} color="primary" variant="outlined" />
            <Button size="small" startIcon={<RefreshIcon />} onClick={startRound} disabled={saving}>お題を変える</Button>
          </Stack>

          {source && (
            <Paper variant="outlined" sx={{ p: 1.3, bgcolor: 'action.hover' }}>
              <Typography variant="caption" color="text.secondary" fontWeight={900}>PORTAL SEED · {source.sourceType}</Typography>
              <Typography fontWeight={850} sx={{ mt: 0.3 }}>{source.title || '無題のネタ'}</Typography>
              {source.text && <Typography variant="body2" color="text.secondary" sx={{ mt: 0.4, whiteSpace: 'pre-wrap' }}>{source.text.slice(0, 500)}</Typography>}
            </Paper>
          )}

          <Box>
            <Typography variant="overline" color="primary.main" fontWeight={900}>お題</Typography>
            <Typography variant="h5" fontWeight={900} sx={{ mt: 0.2, lineHeight: 1.45 }}>{prompt || 'お題を読み込んでいます…'}</Typography>
          </Box>

          <TextField
            fullWidth multiline minRows={4} value={answer}
            onChange={(event) => setAnswer(event.target.value)}
            placeholder="思いついたことを、きれいにまとめずそのまま書いてください。"
            label="最初の回答" disabled={submitted}
          />

          <Divider />

          <Box>
            <Stack direction="row" spacing={0.8} alignItems="center">
              <BoltIcon color="warning" /><Typography fontWeight={900}>ここから拡散する</Typography>
            </Stack>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.4, mb: 1 }}>
              変異は任意です。選んだ場合は、元案と変異案のどちらを残したいかまで記録します。
            </Typography>
            <Stack direction="row" flexWrap="wrap" useFlexGap spacing={0.7}>
              {LENSES.map((item) => (
                <Chip
                  key={item.id} clickable label={item.label}
                  color={mutation === item.id ? 'primary' : 'default'}
                  variant={mutation === item.id ? 'filled' : 'outlined'}
                  onClick={() => !submitted && setMutation((current) => current === item.id ? '' : item.id)}
                />
              ))}
            </Stack>
          </Box>

          {mutation && (
            <TextField
              fullWidth multiline minRows={3} value={mutationAnswer}
              onChange={(event) => {
                setMutationAnswer(event.target.value);
                if (!event.target.value.trim()) setPreferredVersion('');
              }}
              label={LENSES.find((item) => item.id === mutation)?.label + 'で変異'}
              helperText={mutationPrompt}
              disabled={submitted}
            />
          )}

          {mutationAnswer.trim() && (
            <Box>
              <Typography fontWeight={900}>残すならどっち？</Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 0.3, mb: 1 }}>
                この比較が「何を面白いと判断したか」の強いデータになります。
              </Typography>
              <ToggleButtonGroup
                exclusive value={preferredVersion}
                onChange={(_, value) => !submitted && setPreferredVersion(value || '')}
                size="small"
                sx={{ flexWrap: 'wrap', gap: 0.5 }}
              >
                {PREFERENCES.map(([id, label]) => <ToggleButton key={id} value={id}>{label}</ToggleButton>)}
              </ToggleButtonGroup>
            </Box>
          )}

          <Box>
            <Typography fontWeight={900}>「自分っぽさ」が出た方向</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.3, mb: 1 }}>
              複数選択可。分類は固定的な診断ではなく、後から組み替えられる観測ラベルです。
            </Typography>
            <Stack direction="row" flexWrap="wrap" useFlexGap spacing={0.7}>
              {SIGNALS.map(([id, label]) => (
                <Chip
                  key={id} clickable label={label}
                  color={signals.includes(id) ? 'secondary' : 'default'}
                  variant={signals.includes(id) ? 'filled' : 'outlined'}
                  onClick={() => !submitted && toggleSignal(id)}
                />
              ))}
            </Stack>
          </Box>

          <Box>
            <Typography fontWeight={900}>今回の「自分っぽさ」 <Typography component="span" color="error.main">*</Typography></Typography>
            <Typography variant="body2" color="text.secondary">ボツなら1でもOK。良し悪しを含めて残す方が分析に使えます。</Typography>
            <Rating value={selfRating} onChange={(_, value) => setSelfRating(value || 0)} disabled={submitted} />
          </Box>

          <TextField
            fullWidth value={tasteNote} onChange={(event) => setTasteNote(event.target.value)}
            label="判断メモ（任意）"
            placeholder="例: 発想より言い方が好き / 実用的すぎて面白くない"
            inputProps={{ maxLength: 1000 }}
            disabled={submitted}
          />

          {signalLabels.length > 0 && (
            <Typography variant="caption" color="text.secondary">記録するシグナル: {signalLabels.join(' / ')}</Typography>
          )}

          {!submitted ? (
            <Button
              variant="contained" size="large" startIcon={<AutoAwesomeIcon />}
              onClick={saveRound} disabled={!canSave || saving}
            >
              {saving ? '発想データを保存中…' : 'この発想を記録する'}
            </Button>
          ) : (
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
              <Button variant="contained" startIcon={<ShuffleIcon />} onClick={startRound}>次のお題</Button>
              <Button variant="outlined" onClick={retrySamePrompt}>同じお題で別案</Button>
            </Stack>
          )}
        </Stack>
      </Paper>

      {recentResponses.length > 0 && (
        <Paper elevation={0} variant="outlined" sx={{ mt: 1.5, p: 1.5, borderRadius: 2.5 }}>
          <Typography fontWeight={900}>最近の記録</Typography>
          <Stack spacing={1} sx={{ mt: 1 }}>
            {recentResponses.slice(0, 3).map((item) => (
              <Box key={item.id}>
                <Typography variant="body2" fontWeight={800} noWrap>{item.answer || '—'}</Typography>
                <Typography variant="caption" color="text.secondary">
                  {responseTimestamp(item)} · 自分っぽさ {item.selfRating || '—'}/5
                  {item.preferredVersion ? ` · 選択 ${PREFERENCES.find(([id]) => id === item.preferredVersion)?.[1] || item.preferredVersion}` : ''}
                </Typography>
              </Box>
            ))}
          </Stack>
        </Paper>
      )}

      <Paper elevation={0} variant="outlined" sx={{ mt: 1.5, p: 1.5, borderRadius: 2.5 }}>
        <Typography fontWeight={900}>何が「センス」のデータになるか</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, lineHeight: 1.7 }}>
          回答そのものだけでなく、どの変異レンズを選んだか、元案と変異案のどちらを残したか、
          自己評価、観測ラベル、判断メモを保存します。AgentはMCP経由で生データを読み、
          高評価・低評価双方の差分から仮説を作れる設計です。
        </Typography>
      </Paper>
    </Box>
  );
}
