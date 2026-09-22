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

const SCHEMA_VERSION = 3;

const SIGNALS = [
  ['unexpected', '意外性'], ['inversion', '逆転'], ['absurd', '不条理'], ['useful', '実用性'],
  ['specific', '具体性'], ['metaphor', '比喩'], ['extreme', '極端化'], ['wordplay', '言葉遊び'],
  ['dark', 'ブラック'], ['cute', 'かわいさ'], ['social', '社会観察'], ['minimal', '引き算'],
];

const LENSES = [
  { id: 'shorten', label: '削る', prompt: '同じボケを、説明を減らして半分くらいの長さにする。' },
  { id: 'specific', label: '具体化', prompt: '数字・固有名詞・生活感のある細部を1つだけ足して、絵が浮かぶ回答にする。' },
  { id: 'misdirect', label: '裏切る', prompt: '読み手が予想する方向を一度作ってから、最後で別方向へ落とす。' },
  { id: 'viewpoint', label: '視点変更', prompt: '別の人物・物・立場から同じお題に答える。' },
  { id: 'deadpan', label: '真顔', prompt: '内容はくだらないまま、ニュースや規約のように妙に真面目な言い方にする。' },
];

const PREFERENCES = [
  ['original', '元案'],
  ['mutation', '磨き後'],
  ['both', '両方'],
  ['neither', 'どちらもボツ'],
];

const OGIRI_PROMPTS = [
  { type: 'iya', label: 'こんなの嫌だ', text: 'こんなコンビニは二度と行かない。どんなコンビニ？' },
  { type: 'iya', label: 'こんなの嫌だ', text: 'こんなAIアシスタントは嫌だ。どんなAI？' },
  { type: 'iya', label: 'こんなの嫌だ', text: 'こんな高級ホテルは逆に落ち着かない。どんなホテル？' },
  { type: 'iya', label: 'こんなの嫌だ', text: 'こんな資格試験は受験者が全員途中で帰る。どんな試験？' },
  { type: 'iya', label: 'こんなの嫌だ', text: 'こんなSNSは3日で全ユーザーがいなくなる。どんなSNS？' },

  { type: 'why', label: 'なぜ？', text: '「この医者、たぶん昨日YouTubeで勉強したな」なぜそう思った？' },
  { type: 'why', label: 'なぜ？', text: '新入社員が入社3分で社長に謝られた。何をした？' },
  { type: 'why', label: 'なぜ？', text: 'この動物園、動物より飼育員の方が心配されている。なぜ？' },
  { type: 'why', label: 'なぜ？', text: '世界一静かな炎上が発生。何があった？' },
  { type: 'why', label: 'なぜ？', text: '100年間一度も予約が入らない人気店。どういうこと？' },

  { type: 'hitokoto', label: '一言', text: '絶対に信用できない人が言う「任せてください」の直前の一言とは？' },
  { type: 'hitokoto', label: '一言', text: 'タイムマシンで未来から来た自分が、開口一番に言った一言。' },
  { type: 'hitokoto', label: '一言', text: '面接官が履歴書を見て3秒沈黙。そのあと何と言った？' },
  { type: 'hitokoto', label: '一言', text: 'ロボットが初めて「人間って面倒くさい」と思った瞬間の一言。' },
  { type: 'hitokoto', label: '一言', text: '絶対に行きたくない温泉旅館の館内アナウンス。' },

  { type: 'news', label: '架空ニュース', text: 'どうでもよすぎて逆に速報になったニュースとは？' },
  { type: 'news', label: '架空ニュース', text: '日本中が「そこ？」とツッコんだ政府の重大発表とは？' },
  { type: 'news', label: '架空ニュース', text: 'AI時代ならではの、史上初のしょうもない事件とは？' },
  { type: 'news', label: '架空ニュース', text: '未来の教科書に1行だけ載っている「2020年代最大の勘違い」とは？' },

  { type: 'worst', label: '最悪', text: '世界一やる気のないテーマパーク、新アトラクションの名前は？' },
  { type: 'worst', label: '最悪', text: '絶対に売れないスマホの新機能とは？' },
  { type: 'worst', label: '最悪', text: '史上最も感じの悪い「お客様の声」とは？' },
  { type: 'worst', label: '最悪', text: '一流シェフが人生で唯一、店に出すのをためらった料理名とは？' },

  { type: 'blank', label: '穴埋め', text: '「この会社、福利厚生で○○まで出るらしい」何が出る？' },
  { type: 'blank', label: '穴埋め', text: '「最近の若者は○○までタイパを気にする」何？' },
  { type: 'blank', label: '穴埋め', text: '「AIに仕事を奪われると思っていたら、まさか○○を奪われた」何？' },
  { type: 'blank', label: '穴埋め', text: '「大人になったな」と最悪のタイミングで実感した瞬間。「○○」' },

  { type: 'rule', label: '謎ルール', text: 'この村、観光客が絶対に理解できない謎ルールがある。どんなルール？' },
  { type: 'rule', label: '謎ルール', text: '新人研修の資料に1個だけ明らかにおかしい社内ルール。何？' },
  { type: 'rule', label: '謎ルール', text: '地獄にもコンプラ研修が導入された。最初に追加されたルールとは？' },

  { type: 'character', label: '人物', text: '「こいつ絶対に勇者じゃないな」と思った自己紹介とは？' },
  { type: 'character', label: '人物', text: 'プロの泥棒が新人にだけは絶対やるなと教えること。' },
  { type: 'character', label: '人物', text: 'めちゃくちゃ弱いラスボスが戦闘前に言いそうなこと。' },
];

const PORTAL_PROMPT_BUILDERS = [
  { type: 'portal-iya', label: '自分ネタ', build: (topic) => `こんな「${topic}」は嫌だ。どんなの？` },
  { type: 'portal-hitokoto', label: '自分ネタ', build: (topic) => `「${topic}」を完全に勘違いしている人の一言。` },
  { type: 'portal-why', label: '自分ネタ', build: (topic) => `なぜか「${topic}」だけが法律で禁止された。何があった？` },
  { type: 'portal-news', label: '自分ネタ', build: (topic) => `速報です。「${topic}」界隈で史上最もしょうもない事件が起きました。何？` },
  { type: 'portal-rule', label: '自分ネタ', build: (topic) => `「${topic}」の玄人にしか理解できない謎マナーとは？` },
  { type: 'portal-worst', label: '自分ネタ', build: (topic) => `「${topic}」を台無しにする、余計すぎる新機能とは？` },
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

function sourceTopic(source) {
  const raw = source?.title || source?.text || source?.tags?.[0] || '';
  const oneLine = String(raw).replace(/\s+/g, ' ').replace(/[「」"'“”]/g, '').trim();
  return oneLine.slice(0, 42) || 'このネタ';
}

function makePrompt(source) {
  if (source) {
    const builder = randomItem(PORTAL_PROMPT_BUILDERS);
    return { type: builder.type, label: builder.label, text: builder.build(sourceTopic(source)) };
  }
  return randomItem(OGIRI_PROMPTS);
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
  const [promptType, setPromptType] = useState('');
  const [promptLabel, setPromptLabel] = useState('');
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
        // Try the next Portal collection before falling back to a standard Ogiri prompt.
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
      // Standard Ogiri stays dominant so the lab feels like actual Ogiri.
      // Portal material is occasionally converted into an Ogiri-shaped prompt rather than used as an ideation task.
      const candidate = Math.random() < 0.3 ? await pickPortalSeed() : null;
      const nextPrompt = makePrompt(candidate);
      setSource(candidate);
      setPrompt(nextPrompt.text);
      setPromptType(nextPrompt.type);
      setPromptLabel(nextPrompt.label);
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
      setError('磨き後の回答を書いた場合は、「残すならどっち？」も選んでください。');
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
        promptType,
        promptLabel,
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
        promptTypeCounts: { [promptType || 'unknown']: increment(1) },
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
      setNotice('保存しました。');
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
        <Typography variant="h4" fontWeight={950}>大喜利で、センスを貯める</Typography>
        <Typography color="text.secondary">
          まず普通にボケる。気に入ったら別の切り口でもう一度磨く。
          回答と「どっちを残したか」を蓄積して、自分の笑いの癖を後から分析します。
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
                {profile.totalRounds}回答 · 自分っぽさ平均 {averageRating}/5
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
            <Stack direction="row" spacing={0.7} alignItems="center">
              <Chip label={'#' + (sessionRound || '—')} color="primary" variant="outlined" />
              {promptLabel && <Chip label={promptLabel} size="small" />}
            </Stack>
            <Button size="small" startIcon={<RefreshIcon />} onClick={startRound} disabled={saving}>次のお題</Button>
          </Stack>

          {source && (
            <Typography variant="caption" color="text.secondary">
              Portalの「{sourceTopic(source)}」を材料にしたお題
            </Typography>
          )}

          <Box sx={{ py: { xs: 1, sm: 2 } }}>
            <Typography variant="h4" fontWeight={950} sx={{ lineHeight: 1.45 }}>
              {prompt || 'お題を読み込んでいます…'}
            </Typography>
          </Box>

          <TextField
            fullWidth multiline minRows={3} value={answer}
            onChange={(event) => setAnswer(event.target.value)}
            placeholder="回答"
            label="あなたの回答" disabled={submitted}
            autoFocus
          />

          <Divider />

          <Box>
            <Stack direction="row" spacing={0.8} alignItems="center">
              <BoltIcon color="warning" /><Typography fontWeight={900}>もう一段だけ磨く（任意）</Typography>
            </Stack>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.4, mb: 1 }}>
              アイデアを広げるのではなく、同じボケを別の笑わせ方に調整します。
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
              fullWidth multiline minRows={2} value={mutationAnswer}
              onChange={(event) => {
                setMutationAnswer(event.target.value);
                if (!event.target.value.trim()) setPreferredVersion('');
              }}
              label={LENSES.find((item) => item.id === mutation)?.label + '版'}
              helperText={mutationPrompt}
              disabled={submitted}
            />
          )}

          {mutationAnswer.trim() && (
            <Box>
              <Typography fontWeight={900}>残すならどっち？</Typography>
              <ToggleButtonGroup
                exclusive value={preferredVersion}
                onChange={(_, value) => !submitted && setPreferredVersion(value || '')}
                size="small"
                sx={{ mt: 0.8, flexWrap: 'wrap', gap: 0.5 }}
              >
                {PREFERENCES.map(([id, label]) => <ToggleButton key={id} value={id}>{label}</ToggleButton>)}
              </ToggleButtonGroup>
            </Box>
          )}

          <Box>
            <Typography fontWeight={900}>この回答の「自分っぽさ」 <Typography component="span" color="error.main">*</Typography></Typography>
            <Typography variant="body2" color="text.secondary">ボツなら1でOK。</Typography>
            <Rating value={selfRating} onChange={(_, value) => setSelfRating(value || 0)} disabled={submitted} />
          </Box>

          <Box>
            <Typography fontWeight={900}>何が自分っぽかった？（任意）</Typography>
            <Stack direction="row" flexWrap="wrap" useFlexGap spacing={0.7} sx={{ mt: 0.8 }}>
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

          <TextField
            fullWidth value={tasteNote} onChange={(event) => setTasteNote(event.target.value)}
            label="メモ（任意）"
            placeholder="例: 内容より言い回しが好き / 説明しすぎた"
            inputProps={{ maxLength: 1000 }}
            disabled={submitted}
          />

          {signalLabels.length > 0 && (
            <Typography variant="caption" color="text.secondary">記録: {signalLabels.join(' / ')}</Typography>
          )}

          {!submitted ? (
            <Button
              variant="contained" size="large" startIcon={<AutoAwesomeIcon />}
              onClick={saveRound} disabled={!canSave || saving}
            >
              {saving ? '保存中…' : '回答を保存'}
            </Button>
          ) : (
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
              <Button variant="contained" startIcon={<ShuffleIcon />} onClick={startRound}>次のお題</Button>
              <Button variant="outlined" onClick={retrySamePrompt}>同じお題でもう一回答える</Button>
            </Stack>
          )}
        </Stack>
      </Paper>

      {recentResponses.length > 0 && (
        <Paper elevation={0} variant="outlined" sx={{ mt: 1.5, p: 1.5, borderRadius: 2.5 }}>
          <Typography fontWeight={900}>最近の回答</Typography>
          <Stack spacing={1} sx={{ mt: 1 }}>
            {recentResponses.slice(0, 3).map((item) => (
              <Box key={item.id}>
                <Typography variant="caption" color="text.secondary">{item.promptLabel || '大喜利'} · {responseTimestamp(item)}</Typography>
                <Typography variant="body2" fontWeight={800} noWrap>{item.answer || '—'}</Typography>
                <Typography variant="caption" color="text.secondary">
                  自分っぽさ {item.selfRating || '—'}/5
                  {item.preferredVersion ? ` · 選択 ${PREFERENCES.find(([id]) => id === item.preferredVersion)?.[1] || item.preferredVersion}` : ''}
                </Typography>
              </Box>
            ))}
          </Stack>
        </Paper>
      )}
    </Box>
  );
}
