import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert, Box, Button, Chip, Divider, LinearProgress, Paper, Rating, Stack, TextField,
  Typography, useTheme,
} from '@mui/material';
import {
  AutoAwesome as AutoAwesomeIcon, Bolt as BoltIcon, Refresh as RefreshIcon, Shuffle as ShuffleIcon,
} from '@mui/icons-material';
import { addDoc, collection, doc, getDocs, increment, limit, orderBy, query, serverTimestamp, setDoc } from 'firebase/firestore';
import { db } from '../firebase';

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

function randomItem(items) {
  return items[Math.floor(Math.random() * items.length)];
}

function normalizeSource(item, source) {
  return {
    sourceType: source,
    sourceId: item.id,
    title: item.title || item.name || item.content || '',
    text: item.content || item.summary || item.description || '',
    tags: item.tags || [],
  };
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
  const [round, setRound] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  const startRound = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const collectionName = randomItem(['ideas', 'stocks', 'hobbies']);
      let candidate = null;
      try {
        const snap = await getDocs(query(collection(db, collectionName), orderBy('createdAt', 'desc'), limit(20)));
        const items = snap.docs.map((item) => ({ id: item.id, ...item.data() }));
        if (items.length) candidate = normalizeSource(randomItem(items), collectionName);
      } catch {
        // Legacy collections may not have the requested index; use the prompt deck.
      }

      setSource(candidate);
      setPrompt(candidate
        ? randomItem([
          'このネタを、まったく別の用途に変えてください。',
          'このネタから「誰も思いつかなそうな商品」を1つ作ってください。',
          'このネタを、くだらない方向へ10倍拡張してください。',
          'このネタと無関係そうなものを1つ衝突させてください。',
        ])
        : randomItem(FALLBACK_PROMPTS));
      setAnswer('');
      setMutation('');
      setMutationAnswer('');
      setSignals([]);
      setSelfRating(0);
      setSubmitted(false);
      setRound((value) => value + 1);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { startRound(); }, [startRound]);

  const mutationPrompt = useMemo(
    () => LENSES.find((item) => item.id === mutation)?.prompt || '',
    [mutation],
  );

  const toggleSignal = (id) => {
    setSignals((current) => current.includes(id)
      ? current.filter((item) => item !== id)
      : [...current, id]);
  };

  const saveRound = async () => {
    if (!answer.trim()) return;
    setSaving(true);
    setError('');
    try {
      const responseRef = await addDoc(collection(db, 'ogiri_responses'), {
        round,
        prompt,
        source,
        answer: answer.trim().slice(0, 10000),
        mutation,
        mutationPrompt,
        mutationAnswer: mutationAnswer.trim().slice(0, 10000),
        signals,
        selfRating,
        createdAt: serverTimestamp(),
      });

      const signalCounts = Object.fromEntries(
        SIGNALS.map(([id]) => [id, increment(signals.includes(id) ? 1 : 0)]),
      );
      const profileRef = doc(db, 'creative_profile', 'primary');
      await setDoc(profileRef, {
        totalRounds: increment(1),
        ratingSum: increment(Number(selfRating) || 0),
        lastResponseId: responseRef.id,
        lastUpdatedAt: serverTimestamp(),
        lastSignals: signals,
        signalCounts,
      }, { merge: true });

      setSubmitted(true);
      setNotice('この回答を「発想の癖」のデータとして保存しました。');
    } catch (err) {
      setError(err.message || '保存に失敗しました。');
    } finally {
      setSaving(false);
    }
  };

  const signalLabels = signals.map((id) => SIGNALS.find(([key]) => key === id)?.[1]).filter(Boolean);

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
          正解を当てるゲームではなく、あなたが「どうズラすか」を記録する発想トレーニングです。
          回答・変異方向・自己評価を蓄積し、後からAIがあなたの創造性の傾向を参照できる形にします。
        </Typography>
      </Stack>

      {error && <Alert severity="error" sx={{ mb: 1.5 }}>{error}</Alert>}
      {notice && <Alert severity="success" sx={{ mb: 1.5 }} onClose={() => setNotice('')}>{notice}</Alert>}
      {loading && <LinearProgress sx={{ mb: 1.5 }} />}

      <Paper elevation={0} sx={{ p: { xs: 1.5, sm: 2.5 }, border: '1px solid ' + (isDark ? 'rgba(255,255,255,.12)' : 'rgba(40,70,90,.14)'), borderRadius: 3 }}>
        <Stack spacing={2}>
          <Stack direction="row" justifyContent="space-between" alignItems="center">
            <Chip label={'ROUND ' + (round || '—')} color="primary" variant="outlined" />
            <Button size="small" startIcon={<RefreshIcon />} onClick={startRound} disabled={saving}>お題を変える</Button>
          </Stack>

          {source && (
            <Paper variant="outlined" sx={{ p: 1.3, bgcolor: 'action.hover' }}>
              <Typography variant="caption" color="text.secondary" fontWeight={900}>PORTAL SEED · {source.sourceType}</Typography>
              <Typography fontWeight={850} sx={{ mt: 0.3 }}>{source.title}</Typography>
              {source.text && <Typography variant="body2" color="text.secondary" sx={{ mt: 0.4, whiteSpace: 'pre-wrap' }}>{source.text.slice(0, 500)}</Typography>}
            </Paper>
          )}

          <Box>
            <Typography variant="overline" color="primary.main" fontWeight={900}>お題</Typography>
            <Typography variant="h5" fontWeight={900} sx={{ mt: 0.2, lineHeight: 1.45 }}>{prompt || 'お題を読み込んでいます…'}</Typography>
          </Box>

          <TextField fullWidth multiline minRows={4} value={answer} onChange={(event) => setAnswer(event.target.value)}
            placeholder="思いついたことを、きれいにまとめずそのまま書いてください。" label="あなたの回答" disabled={submitted} />

          <Divider />

          <Box>
            <Stack direction="row" spacing={0.8} alignItems="center">
              <BoltIcon color="warning" /><Typography fontWeight={900}>ここから拡散する</Typography>
            </Stack>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.4, mb: 1 }}>
              1つ選ぶと、同じ回答を別方向へ変異させます。完成度より「ズラし方」を残します。
            </Typography>
            <Stack direction="row" flexWrap="wrap" useFlexGap spacing={0.7}>
              {LENSES.map((item) => (
                <Chip key={item.id} clickable label={item.label} color={mutation === item.id ? 'primary' : 'default'}
                  variant={mutation === item.id ? 'filled' : 'outlined'} onClick={() => !submitted && setMutation(item.id)} />
              ))}
            </Stack>
          </Box>

          {mutation && (
            <TextField fullWidth multiline minRows={3} value={mutationAnswer} onChange={(event) => setMutationAnswer(event.target.value)}
              label={LENSES.find((item) => item.id === mutation)?.label + 'で変異'} helperText={mutationPrompt} disabled={submitted} />
          )}

          <Box>
            <Typography fontWeight={900}>「自分っぽさ」が出た方向</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.3, mb: 1 }}>
              複数選択できます。これはAIの評価ではなく、あなた自身の自己ラベリングです。
            </Typography>
            <Stack direction="row" flexWrap="wrap" useFlexGap spacing={0.7}>
              {SIGNALS.map(([id, label]) => (
                <Chip key={id} clickable label={label} color={signals.includes(id) ? 'secondary' : 'default'}
                  variant={signals.includes(id) ? 'filled' : 'outlined'} onClick={() => !submitted && toggleSignal(id)} />
              ))}
            </Stack>
          </Box>

          <Box>
            <Typography fontWeight={900}>今回の「自分っぽさ」</Typography>
            <Rating value={selfRating} onChange={(_, value) => setSelfRating(value || 0)} disabled={submitted} />
          </Box>

          {signalLabels.length > 0 && <Typography variant="caption" color="text.secondary">記録するシグナル: {signalLabels.join(' / ')}</Typography>}

          {!submitted ? (
            <Button variant="contained" size="large" startIcon={<AutoAwesomeIcon />} onClick={saveRound} disabled={!answer.trim() || saving}>
              {saving ? '発想データを保存中…' : 'この発想を記録する'}
            </Button>
          ) : (
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
              <Button variant="contained" startIcon={<ShuffleIcon />} onClick={startRound}>次のお題</Button>
              <Button variant="outlined" onClick={() => { setSubmitted(false); setNotice(''); }}>この回答をもう一度練る</Button>
            </Stack>
          )}
        </Stack>
      </Paper>

      <Paper elevation={0} variant="outlined" sx={{ mt: 1.5, p: 1.5, borderRadius: 2.5 }}>
        <Typography fontWeight={900}>この機能で蓄積するもの</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, lineHeight: 1.7 }}>
          お題、元になったPortalのネタ、あなたの回答、変異後の回答、選んだ発想シグナル、
          「自分っぽさ」の自己評価を1ラウンド単位で保存します。後からAgentがこれらを分析して、
          「あなたは何を面白いと感じ、どんな方向へ発想を飛ばしやすいか」をContext Storeへ抽出できる設計です。
        </Typography>
      </Paper>
    </Box>
  );
}
