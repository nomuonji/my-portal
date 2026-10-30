import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Accordion, AccordionDetails, AccordionSummary, Alert, Box, Button, Card, CardContent,
  Chip, CircularProgress, Dialog, Divider, FormControl, Grid, IconButton, InputLabel, MenuItem,
  Select, Stack, TextField, Typography,
} from '@mui/material';
import {
  Add as AddIcon, ArchiveOutlined as ArchiveIcon, ContentCopy as CopyIcon,
  EditOutlined as EditIcon, ExpandMore as ExpandMoreIcon, History as HistoryIcon,
  Refresh as RefreshIcon, SaveOutlined as SaveIcon,
  ThumbUpAltOutlined as FeedbackIcon,
} from '@mui/icons-material';
import {
  collection, doc, getDoc, getDocs, increment, limit, orderBy, query, serverTimestamp,
  updateDoc, where, writeBatch,
} from '../documentDbClient';
import { db } from '../firebase';

const TYPE_OPTIONS = [
  ['song', '曲・音楽'], ['lyrics', '歌詞'], ['article', '文章・記事'], ['video', '動画'],
  ['script', '台本'], ['image', '画像'], ['code', 'コード'], ['prompt', 'プロンプト'], ['other', 'その他'],
];
const FORMAT_OPTIONS = ['markdown', 'text', 'json', 'code', 'html', 'url'];
const VERDICT_OPTIONS = [
  ['love', 'かなり良い'], ['good', '良い'], ['review', '保留・記録'], ['revise', '修正したい'], ['reject', 'ボツ'],
];
const EMPTY_CONTENT = {
  title: '', type: 'song', summary: '', tagsText: '', content: '', contentFormat: 'markdown',
  externalUrl: '', promptNotes: '', model: '', metadataText: '{}',
};
const EMPTY_VERSION = { content: '', contentFormat: 'markdown', externalUrl: '', changeSummary: '', promptNotes: '', model: '' };
const EMPTY_FEEDBACK = { score: '3', verdict: 'review', scoresText: '{}', feedback: '', strengthsText: '', improvementsText: '' };

function fromSnapshot(snapshot) {
  return snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
}
function formatDate(value) {
  if (!value) return '—';
  const date = value?.toDate ? value.toDate() : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  }).format(date);
}
function parseObject(value, label) {
  let parsed;
  try { parsed = JSON.parse(value || '{}'); } catch (_) { throw new Error(label + 'は正しいJSONで入力してください'); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error(label + 'はJSONオブジェクトにしてください');
  return parsed;
}
function splitTags(value) {
  return [...new Set(String(value || '').split(/[,、\n]/).map((item) => item.trim()).filter(Boolean))];
}
let initialSongSeedPromise = null;

function ensureInitialSongSeed() {
  if (!initialSongSeedPromise) {
    initialSongSeedPromise = (async () => {
      const outputId = 'suno-song-hell-awaits-us-20261031';
      const outputRef = doc(db, 'outputs', outputId);
      const existing = await getDoc(outputRef);
      if (existing.exists()) return false;

      const versionRef = doc(db, 'output_versions', outputId + '__v000001');
      const batch = writeBatch(db);
      batch.set(outputRef, {
        title: '地獄が俺たちを待っている',
        type: 'song',
        summary: 'インド映画風の壮大な恋愛ミュージカル。Sunoでの音源生成に向けた歌詞とStyle Promptの初稿。',
        tags: ['Suno', '歌詞', 'Bollywood Pop', '恋愛', 'Cinematic Pop'],
        metadata: {
          platform: 'Suno',
          genre: 'Bollywood-inspired Cinematic Pop / Orchestral Dance Pop',
          language: 'Japanese',
          stylePrompt: "Japanese cinematic pop, Bollywood-inspired orchestral dance music, dramatic male and female duet, sweeping emotional strings, Indian percussion and tabla, powerful cinematic drums, exotic melodic motifs, passionate vocals, romantic melodrama, sudden comedic spoken interludes, massive uplifting chorus, theatrical arrangement, explosive finale, bittersweet and absurd.",
          status: 'lyrics-ready',
          origin: 'ChatGPT conversation, 2026-10-31',
        },
        status: 'active',
        currentVersion: 1,
        versionCount: 1,
        currentVersionId: versionRef.id,
        ratingCount: 0,
        ratingTotal: 0,
        ratingAverage: null,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        schemaVersion: 1,
      });
      batch.set(versionRef, {
        outputId,
        versionNumber: 1,
        content: "# 地獄が俺たちを待っている\n\n[Intro – Female Whisper]\nインド映画みたいに\n私を崖から救って\n\n[Verse 1 – Male Vocal]\n君は少し笑って\n僕の手を引いた\nどこへ行くのかなんて\n聞かないことにした\n\n世界の果てまで逃げよう\n誰にも見つからないように\n現実なんて忘れてしまおう\n今夜だけは夢の中に\n\n[Pre-Chorus – Rising Strings]\nごめんね\nまるでピロートークみたいに\n君といると酔いが回る\n\nでも窓の外では\n朝が始まっている\n\n[Chorus – Massive Cinematic Arrangement]\nさあ現実に帰ろう\n地獄が俺たちを待っている\n\n愛してると言うには\nこの世界は少し広すぎる\n\nさあ現実に帰ろう\nそれでも君と歩いていこう\n\n神様が何もしてくれないなら\n僕たちが抱きしめればいい\n\n[Verse 2 – Rhythmic, Playful]\n恋愛にはルールがあるらしい\nモテる男はボケるらしい\n相手がツッコめるように\nわざと隙を作るらしい\n\n眠いよ？ちゃんこそちゃんこそ！\n大丈夫！ understand？\n\nそんなことを言っている間に\n世界の終わりが近づいている\n\n[Pre-Chorus 2 – Female Vocal]\n俺が女だったらやらないけど\nあなたの判断を優先するよ\n\nあなたはあなたの生きたいように\n生きたらいいと思う\n\n[Chorus – Full Choir]\nさあ現実に帰ろう\n地獄が俺たちを待っている\n\n幸せになれるかなんて\n誰にも分かりはしないけど\n\nさあ現実に帰ろう\nそれでも君と歩いていこう\n\n完璧な世界じゃきっと\n愛も虚しい\n\n[Bridge – Bollywood Dance Break]\nああ！\n運命の崖を飛び越えて！\n\nああ！\n名前のない明日へ！\n\n走れ！\n走れ！\n\n……ちょっと待って\nどっちが崖から落ちるんだ？\n\n[Breakdown – Piano and Soft Vocals]\n一人の人間の中には\n行かないでと抱きつく女の子と\n死に向かう男の子が住んでいる\n\n君の中にもいるのかな\nそれとも僕だけなのかな\n\n[Final Chorus – Explosive Orchestral Finale]\nさあ現実に帰ろう\n地獄が俺たちを待っている\n\nそれでも君といる時間は\n少しだけ夢に似ていた\n\nさあ現実に帰ろう\n朝日が街を照らしている\n\nインド映画みたいな奇跡はなくても\n僕たちはここにいる\n\n[Outro – Spoken, Male]\n……ところで、今日何食べる？\n\n[End]",
        contentFormat: 'markdown',
        externalUrl: null,
        changeSummary: '初版：歌詞＋Suno Style Promptを登録',
        promptNotes: 'Suno Style Prompt:\n' + "Japanese cinematic pop, Bollywood-inspired orchestral dance music, dramatic male and female duet, sweeping emotional strings, Indian percussion and tabla, powerful cinematic drums, exotic melodic motifs, passionate vocals, romantic melodrama, sudden comedic spoken interludes, massive uplifting chorus, theatrical arrangement, explosive finale, bittersweet and absurd.",
        model: 'ChatGPT',
        createdAt: serverTimestamp(),
        schemaVersion: 1,
      });
      await batch.commit();
      return true;
    })().finally(() => { initialSongSeedPromise = null; });
  }
  return initialSongSeedPromise;
}


let additionalSongSeedPromise = null;

function ensureAdditionalSongSeeds() {
  if (!additionalSongSeedPromise) {
    additionalSongSeedPromise = (async () => {
      const songs = [
        {
          id: 'suno-song-kamisama-no-teitaraku-20261031',
          title: '神様の体たらく',
          summary: '哲学的な独白と低俗で不条理な冗談を同じ温度で並置する、Art Rock / Alternativeの楽曲。',
          genre: 'Art Rock / Alternative',
          tags: ['Suno', '歌詞', 'Art Rock', 'Alternative', 'Dark Comedy', '哲学', 'ネット文化'],
          stylePrompt: 'Japanese alternative art rock, post-punk, experimental indie rock, dark comedy, theatrical male vocals, deadpan spoken-word verses, explosive melodic chorus, melancholic piano bridge, distorted guitars, driving bass, dynamic live drums, unexpected tonal shifts, poetic and absurd, eccentric internet culture, existential but playful, emotional yet irreverent, memorable singalong hook.',
          styleNotes: '普通のJ-POPにせず、哲学的な独白とバカバカしい歌詞が同居できる音楽性。投稿をそのまま並べた替え歌ではなく、投稿に何度も現れる世界観を一つの曲にする。',
          content: `[Intro – Spoken, almost emotionless]

人生とは確率的な世界の主体的な観測であると。

……まあ、いいか。

テーブルを見る。
街は見ない。
関係ないから。

[Verse 1]

死ぬのが怖くて文明を作った
逃げるために神様を作った
正しさから遠ざかるほど
世界は上手く回るらしい

自由意志なんてないんだと
ある日を境に決めたけど
Aボタンを連打するのか
Bボタンを連打するのか

そんな程度の人生なら
せめて面白くしてくれよ
汚いケーキが届いたって
むしゃむしゃ食えばいいだろ

[Pre-Chorus]

思想を持つ奴はいる
芸を持つ奴もいる
でも思想を芸にできる奴は
なかなかいないらしい

[Chorus – Explosive, melodic]

神様の体たらくを
俺たちの愛で埋めるのさ
完璧な世界じゃきっと
愛も虚しい

正しいことばかり言わないで
間違いの中で踊ろうぜ
聖なる喜劇が俺を呼んでいる
この世界はまだ終わらない

[Verse 2 – Rhythmic, playful delivery]

人が喋ってるのか
法人が喋ってるのか
もうよく分からない時代に
AIが人間ごっこしてる

俺の中ではずっと
デンジとマキマが戦ってる
思想と本能と欲望が
同じ部屋で喧嘩してる

例えから帰ってこない馬鹿が
衛星カメラに映ったあと
今ごろ火星人のメタファーの中で
主役をやっているらしい

[Pre-Chorus 2 – Gradually building]

一人の人間の中には
死に向かう男の子がいて
行かないでと抱きつく女の子がいる

どちらも俺なんだ
どちらも俺なんだ

[Chorus – Full band]

神様の体たらくを
俺たちの愛で埋めるのさ
完璧な世界じゃきっと
愛も虚しい

幸せな人間は大爆笑なんて
できないのかもしれないけど
聖なる喜劇が俺を呼んでいる
まだ笑えるうちは踊ろうぜ

[Bridge – Soft piano, intimate vocal]

来世はきっとショベルカーになって
デッカイ穴をたくさん掘るんだ

仕事の電話なんかもう鳴らない
僕はただ穴を掘るんだ

この星なんて要らないのさ
僕は星を減らして空を作るんだ

僕はひたすら
デッカイ宇宙を作るんだ

[Final Chorus – Dramatic, layered vocals]

神様の体たらくを
俺たちの愛で埋めるのさ
完璧な世界じゃきっと
愛も虚しい

何もかもが間違いなら
間違いのままで生きていこう
聖なる喜劇が俺を呼んでいる
俺はまだここにいる

[Outro – Spoken, deadpan]

腰抜けどもが爪弾き。

……いや、なんでもない。`
        },
        {
          id: 'suno-song-gekaio-suberu-ou-20261031',
          title: '下界を統べる王',
          summary: 'トノサマバッタの尊大さと虫としての日常の落差を、80年代ディスコ歌謡で大真面目に歌うComedy Pop。',
          genre: '80s Japanese Disco Kayokyoku / Funk',
          tags: ['Suno', '歌詞', 'Disco', 'Funk', 'Comedy Pop', 'トノサマバッタ', '電波ソング'],
          stylePrompt: 'Japanese 1980s disco kayokyoku, electro funk, funky slap bass, groovy four-on-the-floor drums, bright brass stabs, vintage analog synthesizers, theatrical deep male vocals, playful falsetto backing vocals, absurd comedy lyrics, infectious singalong chorus, flamboyant dance break, dramatic key change, energetic and ridiculous, polished retro production.',
          styleNotes: '80年代ディスコ歌謡 × ファンキーな電波ソング。歌詞のくだらなさに対して音楽を一切ふざけさせず、大真面目な王様の戴冠式として豪華なブラスとコーラスで歌わせる。',
          content: `[Intro – Funky Spoken Voice]

Ladies and gentlemen!

下界の諸君、聞こえるか！

俺はこの下界を統べる王！

……バッタです。

[Verse 1]

朝日が昇れば俺の時間
草むら全体が俺の城
誰が決めたか知らないが
俺ほど飛べる虫は居ない

地面に這いつくばる君たち
少しは空を見上げたまえ
俺は王様　君は何様
とりあえず葉っぱを食べている

[Pre-Chorus]

不覚にも先ほど
バッタ面で泣きました
王にも涙はあるのです
下界には分からないでしょう

[Chorus – Huge Disco Hook]

俺はこの下界を統べる王！
俺ほど飛べる虫は居ない！

飛べ！ 飛べ！ 飛べ！
天井なんか突き破れ！

俺はこの下界を統べる王！
下界はゴミのようなバカばかり！

踊れ！ 踊れ！ 踊れ！
今夜は俺の戴冠式！

[Verse 2]

神様だって忙しい
世界の管理もままならない
完璧な世界はいらないと
誰かが言っていた気がする

金持ちビビってる　ヘイヘイヘイ！
革命前夜のバッタの群れ
正義と倫理と自由意志
全部まとめて草にしよう

[Pre-Chorus 2 – Female Backing Vocals]

王様、王様、どちらへ行くの？
王様、王様、何を食べるの？

[Spoken]

……草です。

[Chorus – More Energetic]

俺はこの下界を統べる王！
俺ほど飛べる虫は居ない！

飛べ！ 飛べ！ 飛べ！
重力なんか知ったことか！

俺はこの下界を統べる王！
下界はゴミのようなバカばかり！

踊れ！ 踊れ！ 踊れ！
今夜は俺の戴冠式！

[Bridge – Sudden Romantic Slowdown]

神様の体たらくを
誰かの愛で埋めるのさ

完璧な世界じゃあ
きっと愛も虚しい

だから俺は今日も飛ぶ
誰にも頼まれてないけど

小さな体で
大きな空を夢見ている

[Dance Break – Chant]

バッタ！ バッタ！
トノサマ！ バッタ！

王冠！ 王冠！
草むら！ 王国！

バッタ！ バッタ！
トノサマ！ バッタ！

誰が何と言おうとも
俺が王だ！

[Final Chorus – Key Change, Full Choir]

俺はこの下界を統べる王！
俺ほど飛べる虫は居ない！

飛べ！ 飛べ！ 飛べ！
星の向こうへ突き抜けろ！

俺はこの下界を統べる王！
下界はゴミのようなバカばかり！

踊れ！ 踊れ！ 踊れ！
今夜は俺の戴冠式！

[Outro – Deadpan]

……あ、鳥だ。

（暗転）`
        },
        {
          id: 'suno-song-ittan-koko-wa-tsuka-20261031',
          title: '一旦ここは通過で（笑）',
          summary: '汚いケーキや丸亀製麺、歯医者など、どうでもいい日常を人生の真理のように歌う脱力系City Pop。',
          genre: 'Shibuya-kei / Bossa Nova / Lounge Pop',
          tags: ['Suno', '歌詞', 'Shibuya-kei', 'Bossa Nova', 'Lounge Pop', '日常', '脱力系'],
          stylePrompt: 'Japanese Shibuya-kei, sophisticated bossa nova, 1990s Japanese lounge pop, jazzy acoustic guitar, walking upright bass, brushed drums, vibraphone, playful piano, mellow male vocals with soft female backing harmonies, witty deadpan delivery, elegant and slightly melancholic, catchy melodic chorus, sophisticated retro production, whimsical everyday storytelling, warm analog recording.',
          styleNotes: '脱力系シティポップ × 渋谷系ボサノヴァ。歌詞はしょうもないのに音楽は妙におしゃれ。休日の昼下がりのカフェで流れても違和感がない曲を狙う。',
          content: `[Intro – Soft Spoken]
次の方、お決まりでしたらどうぞ。

……一旦ここは通過で（笑）

[Verse 1]
汚いケーキが届いた午後
そんなに悲しむことはない
むしゃむしゃ食べればいいだろ
クリームが少し曲がってるだけ

本当にオシャレな奴は
ハンガーに金を掛けるらしい
俺はまだそこまでじゃない
でも服はそれなりに綺麗

[Pre-Chorus]
逆張りホットコーヒー
冷める前に飲み干して
何かを選んだ気になって
今日も何も決まらない

[Chorus – Sweet, Catchy]
一旦ここは通過で（笑）
人生なんてそんなもの
決めることなど何もない
通り過ぎてから考えよう

一旦ここは通過で（笑）
悲しいことも食べてしまおう
世界のことはよく知らない
だけどコーヒーは冷めていく

[Verse 2]
丸亀製麺におにぎりを
食べに来た人がいるらしい
「次の方、お決まりでしたら」
「一旦ここは通過で（笑）」

風呂トイレ別はまだ早い
水道代固定は大きな商機
時計が少しズレていたって
それはそれで面白い

[Pre-Chorus 2]
昔は良かったなぁ
何が良かったか知らないけど
過去を振り返ってみたところで
歯医者の予約が待っている

[Chorus – Rich Harmonies]
一旦ここは通過で（笑）
大げさにしなくていいだろ
正しい答えを探すより
とりあえず今日は帰ろう

一旦ここは通過で（笑）
失敗したって食べてしまおう
きっと世界は続いていく
俺の知らないところで

[Bridge – Dreamy, Jazzy]
テーブルを見る
街は見ない
関係ないから

浮かれた人たち
眺めているより
こっちのコーヒーを飲もう

あれも欲しい
これも欲しい
でも今は別にいい

人生はAボタンの連打か
Bボタンの連打でいける

[Instrumental – Vibraphone Solo]

[Final Chorus – Upbeat, Layered Vocals]
一旦ここは通過で（笑）
明日のことは明日でいい
何も上手くいかない日だって
とりあえず腹は減るだろう

一旦ここは通過で（笑）
そんなに深刻にならないで
汚いケーキも悪くない
むしゃむしゃ食えばいいだろ

[Outro – Spoken]
……あれ、奨学金ってもしかして借金？`
        }
      ];

      const batch = writeBatch(db);
      let added = 0;
      for (const song of songs) {
        const outputRef = doc(db, 'outputs', song.id);
        const existing = await getDoc(outputRef);
        if (existing.exists()) continue;
        const versionRef = doc(db, 'output_versions', song.id + '__v000001');
        batch.set(outputRef, {
          title: song.title,
          type: 'song',
          summary: song.summary,
          tags: song.tags,
          metadata: {
            platform: 'Suno',
            genre: song.genre,
            language: 'Japanese',
            stylePrompt: song.stylePrompt,
            styleNotes: song.styleNotes,
            status: 'lyrics-ready',
            origin: 'ChatGPT conversation, 2026-10-31',
          },
          status: 'active',
          currentVersion: 1,
          versionCount: 1,
          currentVersionId: versionRef.id,
          ratingCount: 0,
          ratingTotal: 0,
          ratingAverage: null,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
          schemaVersion: 1,
        });
        batch.set(versionRef, {
          outputId: song.id,
          versionNumber: 1,
          content: '# ' + song.title + '\n\n' + song.content,
          contentFormat: 'markdown',
          externalUrl: null,
          changeSummary: '初版：歌詞完成稿＋Suno Style Promptを登録',
          promptNotes: 'Suno Style Prompt:\n' + song.stylePrompt + '\n\n制作意図:\n' + song.styleNotes,
          model: 'ChatGPT',
          createdAt: serverTimestamp(),
          schemaVersion: 1,
        });
        added += 1;
      }
      if (added > 0) await batch.commit();
      return added;
    })().finally(() => { additionalSongSeedPromise = null; });
  }
  return additionalSongSeedPromise;
}

function typeLabel(value) {
  return TYPE_OPTIONS.find(([key]) => key === value)?.[1] || value || 'その他';
}
function MetaMetric({ label, value }) {
  return (
    <Box sx={{ minWidth: 86 }}>
      <Typography variant="caption" color="text.secondary">{label}</Typography>
      <Typography sx={{ fontFamily: 'var(--p-mono)', fontSize: 16, fontWeight: 800 }}>{value}</Typography>
    </Box>
  );
}
function SectionLabel({ children }) {
  return <Typography variant="overline" color="text.secondary" sx={{ fontWeight: 800, letterSpacing: '0.12em' }}>{children}</Typography>;
}

export default function Outputs() {
  const [items, setItems] = useState([]);
  const [selectedId, setSelectedId] = useState('');
  const [versions, setVersions] = useState([]);
  const [feedbackItems, setFeedbackItems] = useState([]);
  const [selectedVersionId, setSelectedVersionId] = useState('');
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [dialog, setDialog] = useState('');
  const [draft, setDraft] = useState(EMPTY_CONTENT);
  const [versionDraft, setVersionDraft] = useState(EMPTY_VERSION);
  const [feedbackDraft, setFeedbackDraft] = useState(EMPTY_FEEDBACK);

  const selected = items.find((item) => item.id === selectedId) || null;
  const selectedVersion = versions.find((item) => item.id === selectedVersionId)
    || versions.find((item) => item.versionNumber === selected?.currentVersion)
    || versions[0]
    || null;

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const snapshot = await getDocs(query(
        collection(db, 'outputs'),
        orderBy('updatedAt', 'desc'),
        limit(300),
      ));
      const next = fromSnapshot(snapshot);
      setItems(next);
      setSelectedId((current) => current && next.some((item) => item.id === current) ? current : '');
    } catch (err) {
      setError('アウトプットDBを読み込めません: ' + (err.message || String(err)));
    } finally {
      setLoading(false);
    }
  }, []);

  const loadDetail = useCallback(async (id) => {
    if (!id) {
      setVersions([]);
      setFeedbackItems([]);
      setSelectedVersionId('');
      return;
    }
    setDetailLoading(true);
    try {
      const [versionSnapshot, feedbackSnapshot] = await Promise.all([
        getDocs(query(collection(db, 'output_versions'), where('outputId', '==', id))),
        getDocs(query(collection(db, 'output_feedback'), where('outputId', '==', id))),
      ]);
      const nextVersions = fromSnapshot(versionSnapshot).sort((a, b) => Number(b.versionNumber) - Number(a.versionNumber));
      const nextFeedback = fromSnapshot(feedbackSnapshot).sort((a, b) => {
        const left = a.createdAt?.toDate ? a.createdAt.toDate().getTime() : new Date(a.createdAt || 0).getTime();
        const right = b.createdAt?.toDate ? b.createdAt.toDate().getTime() : new Date(b.createdAt || 0).getTime();
        return right - left;
      });
      setVersions(nextVersions);
      setFeedbackItems(nextFeedback);
      setSelectedVersionId((current) => nextVersions.some((item) => item.id === current)
        ? current
        : nextVersions[0]?.id || '');
    } catch (err) {
      setError('版履歴または評価履歴を読み込めません: ' + (err.message || String(err)));
    } finally {
      setDetailLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const initialize = async () => {
      try {
        const seeded = await ensureInitialSongSeed();
        const additionalSeeded = await ensureAdditionalSongSeeds();
        if (!cancelled && (seeded || additionalSeeded > 0)) {
          const messages = [];
          if (seeded) messages.push('初期成果物「地獄が俺たちを待っている」を登録しました');
          if (additionalSeeded > 0) messages.push('追加作品 ' + additionalSeeded + ' 件を登録しました');
          setNotice(messages.join(' / '));
        }
      } catch (err) {
        if (!cancelled) setError('初期成果物の登録に失敗しました: ' + (err.message || String(err)));
      }
      if (!cancelled) load();
    };
    initialize();
    return () => { cancelled = true; };
  }, [load]);
  useEffect(() => { loadDetail(selectedId); }, [selectedId, loadDetail]);

  const filtered = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase();
    return items.filter((item) => {
      if (typeFilter !== 'all' && item.type !== typeFilter) return false;
      if (!needle) return true;
      const haystack = [
        item.title, item.summary, item.type, ...(item.tags || []), JSON.stringify(item.metadata || {}),
      ].join(' ').toLocaleLowerCase();
      return haystack.includes(needle);
    });
  }, [items, search, typeFilter]);

  const counts = useMemo(() => ({
    total: items.length,
    active: items.filter((item) => item.status !== 'archived').length,
    rated: items.filter((item) => Number(item.ratingCount) > 0).length,
  }), [items]);

  const openCreate = () => {
    setDraft(EMPTY_CONTENT);
    setDialog('create');
    setError('');
  };
  const openMetaEdit = () => {
    if (!selected) return;
    setDraft({
      ...EMPTY_CONTENT,
      title: selected.title || '',
      type: selected.type || 'other',
      summary: selected.summary || '',
      tagsText: (selected.tags || []).join(', '),
      metadataText: JSON.stringify(selected.metadata || {}, null, 2),
    });
    setDialog('metadata');
    setError('');
  };
  const openVersion = () => {
    setVersionDraft({ ...EMPTY_VERSION, contentFormat: selectedVersion?.contentFormat || 'markdown' });
    setDialog('version');
    setError('');
  };
  const openFeedback = () => {
    setFeedbackDraft(EMPTY_FEEDBACK);
    setDialog('feedback');
    setError('');
  };

  const createOutput = async () => {
    setSaving(true);
    setError('');
    try {
      const title = draft.title.trim();
      if (!title) throw new Error('タイトルを入力してください');
      if (!draft.content.trim() && !draft.externalUrl.trim()) throw new Error('本文または外部URLを入力してください');
      const metadata = parseObject(draft.metadataText, 'メタデータ');
      const outputRef = doc(collection(db, 'outputs'));
      const versionRef = doc(collection(db, 'output_versions'));
      const batch = writeBatch(db);
      batch.set(outputRef, {
        title, type: draft.type || 'other', summary: draft.summary.trim(),
        tags: splitTags(draft.tagsText), metadata, status: 'active',
        currentVersion: 1, versionCount: 1, currentVersionId: versionRef.id,
        ratingCount: 0, ratingTotal: 0, ratingAverage: null,
        createdAt: serverTimestamp(), updatedAt: serverTimestamp(), schemaVersion: 1,
      });
      batch.set(versionRef, {
        outputId: outputRef.id, versionNumber: 1, content: draft.content,
        contentFormat: draft.contentFormat || 'markdown', externalUrl: draft.externalUrl.trim() || null,
        changeSummary: '初版', promptNotes: draft.promptNotes.trim(), model: draft.model.trim() || null,
        createdAt: serverTimestamp(), schemaVersion: 1,
      });
      await batch.commit();
      setDialog('');
      setNotice('アウトプットを登録しました');
      await load();
      setSelectedId(outputRef.id);
    } catch (err) {
      setError(err.message || '登録に失敗しました');
    } finally {
      setSaving(false);
    }
  };

  const saveMetadata = async () => {
    if (!selected) return;
    setSaving(true);
    setError('');
    try {
      const title = draft.title.trim();
      if (!title) throw new Error('タイトルを入力してください');
      await updateDoc(doc(db, 'outputs', selected.id), {
        title, type: draft.type || 'other', summary: draft.summary.trim(),
        tags: splitTags(draft.tagsText), metadata: parseObject(draft.metadataText, 'メタデータ'),
        updatedAt: serverTimestamp(),
      });
      setDialog('');
      setNotice('タイトル・タグ・メタデータを更新しました。本文の変更は新しい版として保存してください');
      await load();
    } catch (err) {
      setError(err.message || '更新に失敗しました');
    } finally {
      setSaving(false);
    }
  };

  const saveVersion = async () => {
    if (!selected) return;
    setSaving(true);
    setError('');
    try {
      if (!versionDraft.content.trim() && !versionDraft.externalUrl.trim()) throw new Error('本文または外部URLを入力してください');
      const versionNumber = Math.max(Number(selected.currentVersion) || 0, Number(selected.versionCount) || 0) + 1;
      const versionRef = doc(collection(db, 'output_versions'));
      const batch = writeBatch(db);
      batch.set(versionRef, {
        outputId: selected.id, versionNumber, content: versionDraft.content,
        contentFormat: versionDraft.contentFormat || 'markdown',
        externalUrl: versionDraft.externalUrl.trim() || null,
        changeSummary: versionDraft.changeSummary.trim(), promptNotes: versionDraft.promptNotes.trim(),
        model: versionDraft.model.trim() || null, createdAt: serverTimestamp(), schemaVersion: 1,
      });
      batch.update(doc(db, 'outputs', selected.id), {
        currentVersion: versionNumber, versionCount: versionNumber, currentVersionId: versionRef.id,
        updatedAt: serverTimestamp(),
      });
      await batch.commit();
      setDialog('');
      setNotice('v' + versionNumber + ' を保存しました。旧版は履歴に残っています');
      await load();
      await loadDetail(selected.id);
      setSelectedVersionId(versionRef.id);
    } catch (err) {
      setError(err.message || '新しい版の保存に失敗しました');
    } finally {
      setSaving(false);
    }
  };

  const saveFeedback = async () => {
    if (!selected || !selectedVersion) return;
    setSaving(true);
    setError('');
    try {
      const score = Number(feedbackDraft.score);
      if (!Number.isFinite(score) || score < 1 || score > 5) throw new Error('総合点は1〜5点で入力してください');
      const scores = parseObject(feedbackDraft.scoresText, '観点別スコア');
      Object.entries(scores).forEach(([key, value]) => {
        if (!Number.isFinite(Number(value)) || Number(value) < 1 || Number(value) > 5) {
          throw new Error('観点別スコア「' + key + '」は1〜5点にしてください');
        }
      });
      const feedbackRef = doc(collection(db, 'output_feedback'));
      const batch = writeBatch(db);
      batch.set(feedbackRef, {
        outputId: selected.id, versionId: selectedVersion.id, versionNumber: selectedVersion.versionNumber,
        score, scores, verdict: feedbackDraft.verdict, feedback: feedbackDraft.feedback.trim(),
        strengths: splitTags(feedbackDraft.strengthsText),
        improvements: splitTags(feedbackDraft.improvementsText),
        createdAt: serverTimestamp(), schemaVersion: 1,
      });
      batch.update(doc(db, 'outputs', selected.id), {
        ratingCount: increment(1), ratingTotal: increment(score),
        ratingAverage: Math.round((((Number(selected.ratingTotal) || 0) + score) / ((Number(selected.ratingCount) || 0) + 1)) * 100) / 100,
        updatedAt: serverTimestamp(),
      });
      await batch.commit();
      setDialog('');
      setNotice('v' + selectedVersion.versionNumber + ' へのフィードバックを保存しました');
      await load();
      await loadDetail(selected.id);
    } catch (err) {
      setError(err.message || 'フィードバックを保存できませんでした');
    } finally {
      setSaving(false);
    }
  };

  const archiveOutput = async () => {
    if (!selected || !window.confirm('この成果物をアーカイブしますか？版と評価履歴は削除されません。')) return;
    try {
      await updateDoc(doc(db, 'outputs', selected.id), { status: 'archived', updatedAt: serverTimestamp() });
      setNotice('アーカイブしました（履歴は保持されています）');
      await load();
    } catch (err) {
      setError(err.message || 'アーカイブに失敗しました');
    }
  };

  const dialogTitle = {
    create: '新しいアウトプット',
    metadata: '基本情報を編集',
    version: '新しいバージョン',
    feedback: 'バージョンを採点',
  }[dialog] || '';

  return (
    <Box sx={{ maxWidth: 1440, mx: 'auto', pb: 7 }}>
      <Stack direction={{ xs: 'column', md: 'row' }} alignItems={{ md: 'center' }} justifyContent="space-between" gap={2} sx={{ mb: 2.5 }}>
        <Box>
          <SectionLabel>OUTPUT LIBRARY</SectionLabel>
          <Typography variant="h4" sx={{ fontWeight: 900, letterSpacing: '-0.045em' }}>アウトプットDB</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            曲・歌詞・文章・動画・画像・コードなど、生成物を版履歴と評価付きで蓄積します。
          </Typography>
        </Box>
        <Stack direction="row" spacing={1}>
          <Button variant="outlined" startIcon={<RefreshIcon />} onClick={load} disabled={loading}>
            再読み込み
          </Button>
          <Button variant="contained" startIcon={<AddIcon />} onClick={openCreate}>新規登録</Button>
        </Stack>
      </Stack>

      <Grid container spacing={1.2} sx={{ mb: 2 }}>
        <Grid item xs={4}><Card variant="outlined"><CardContent sx={{ py: 1.2, '&:last-child': { pb: 1.2 } }}><MetaMetric label="登録数" value={counts.total} /></CardContent></Card></Grid>
        <Grid item xs={4}><Card variant="outlined"><CardContent sx={{ py: 1.2, '&:last-child': { pb: 1.2 } }}><MetaMetric label="有効" value={counts.active} /></CardContent></Card></Grid>
        <Grid item xs={4}><Card variant="outlined"><CardContent sx={{ py: 1.2, '&:last-child': { pb: 1.2 } }}><MetaMetric label="評価あり" value={counts.rated} /></CardContent></Card></Grid>
      </Grid>

      {error && <Alert severity="error" sx={{ mb: 1.5 }} onClose={() => setError('')}>{error}</Alert>}
      {notice && <Alert severity="success" sx={{ mb: 1.5 }} onClose={() => setNotice('')}>{notice}</Alert>}

      <Grid container spacing={2} alignItems="stretch">
        <Grid item xs={12} md={4}>
          <Card variant="outlined" sx={{ height: { md: 'min(72vh, 900px)' }, display: 'flex', flexDirection: 'column' }}>
            <CardContent sx={{ pb: 1 }}>
              <Stack direction="row" spacing={1}>
                <TextField size="small" fullWidth placeholder="タイトル・タグ・メタデータ検索" value={search} onChange={(event) => setSearch(event.target.value)} />
                <FormControl size="small" sx={{ minWidth: 112 }}>
                  <InputLabel>タイプ</InputLabel>
                  <Select label="タイプ" value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)}>
                    <MenuItem value="all">すべて</MenuItem>
                    {TYPE_OPTIONS.map(([key, label]) => <MenuItem key={key} value={key}>{label}</MenuItem>)}
                  </Select>
                </FormControl>
              </Stack>
            </CardContent>
            <Divider />
            <Box sx={{ overflowY: 'auto', flex: 1, p: 1 }}>
              {loading ? <Box sx={{ display: 'grid', placeItems: 'center', py: 5 }}><CircularProgress size={26} /></Box>
                : filtered.length === 0 ? <Typography color="text.secondary" variant="body2" sx={{ p: 2 }}>まだ成果物がありません。「新規登録」から追加できます。</Typography>
                : filtered.map((item) => (
                  <Card
                    key={item.id}
                    variant={selectedId === item.id ? 'elevation' : 'outlined'}
                    sx={{
                      mb: 1, cursor: 'pointer', borderColor: selectedId === item.id ? 'primary.main' : 'divider',
                      bgcolor: selectedId === item.id ? 'action.selected' : 'background.paper',
                    }}
                    onClick={() => setSelectedId(item.id)}
                  >
                    <CardContent sx={{ py: 1.2, '&:last-child': { pb: 1.2 } }}>
                      <Stack direction="row" justifyContent="space-between" alignItems="flex-start" gap={1}>
                        <Typography sx={{ fontWeight: 800, lineHeight: 1.35, minWidth: 0 }}>{item.title}</Typography>
                        {item.status === 'archived' && <Chip size="small" label="Archive" />}
                      </Stack>
                      <Stack direction="row" spacing={0.6} useFlexGap flexWrap="wrap" sx={{ mt: 0.8 }}>
                        <Chip size="small" label={typeLabel(item.type)} />
                        <Chip size="small" variant="outlined" label={'v' + (item.currentVersion || 1)} />
                        {(item.tags || []).slice(0, 3).map((tag) => <Chip size="small" variant="outlined" key={tag} label={tag} />)}
                      </Stack>
                      <Stack direction="row" justifyContent="space-between" sx={{ mt: 0.9 }}>
                        <Typography variant="caption" color="text.secondary">{item.versionCount || 1} versions</Typography>
                        <Typography variant="caption" color="text.secondary">
                          {Number(item.ratingCount) ? '★ ' + Number(item.ratingAverage).toFixed(1) + ' (' + item.ratingCount + ')' : '未採点'}
                        </Typography>
                      </Stack>
                    </CardContent>
                  </Card>
                ))}
            </Box>
          </Card>
        </Grid>

        <Grid item xs={12} md={8}>
          {!selected ? (
            <Card variant="outlined" sx={{ minHeight: 280, display: 'grid', placeItems: 'center', p: 3 }}>
              <Box sx={{ textAlign: 'center' }}>
                <HistoryIcon sx={{ fontSize: 34, color: 'text.secondary', mb: 1 }} />
                <Typography variant="h6">成果物を選択</Typography>
                <Typography variant="body2" color="text.secondary">左の一覧から選ぶと、本文・バージョン履歴・評価が表示されます。</Typography>
              </Box>
            </Card>
          ) : (
            <Stack spacing={1.5}>
              <Card variant="outlined">
                <CardContent>
                  <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" alignItems={{ sm: 'flex-start' }} gap={1.5}>
                    <Box sx={{ minWidth: 0 }}>
                      <Stack direction="row" spacing={0.8} useFlexGap flexWrap="wrap" sx={{ mb: 0.8 }}>
                        <Chip size="small" label={typeLabel(selected.type)} />
                        {selected.status === 'archived' && <Chip size="small" label="アーカイブ" />}
                      </Stack>
                      <Typography variant="h5" sx={{ fontWeight: 900, overflowWrap: 'anywhere' }}>{selected.title}</Typography>
                      {selected.summary && <Typography variant="body2" color="text.secondary" sx={{ mt: 0.6, whiteSpace: 'pre-wrap' }}>{selected.summary}</Typography>}
                      <Stack direction="row" spacing={2.4} sx={{ mt: 1.5 }}>
                        <MetaMetric label="現行版" value={'v' + (selected.currentVersion || 1)} />
                        <MetaMetric label="版数" value={selected.versionCount || 1} />
                        <MetaMetric label="平均評価" value={Number(selected.ratingCount) ? Number(selected.ratingAverage).toFixed(1) + '/5' : '—'} />
                      </Stack>
                    </Box>
                    <Stack direction="row" spacing={0.5} flexWrap="wrap">
                      <Button size="small" variant="outlined" startIcon={<EditIcon />} onClick={openMetaEdit}>基本情報</Button>
                      <Button size="small" variant="contained" startIcon={<AddIcon />} onClick={openVersion} disabled={selected.status === 'archived'}>新しい版</Button>
                      <IconButton size="small" title="アーカイブ" onClick={archiveOutput} disabled={selected.status === 'archived'}><ArchiveIcon /></IconButton>
                    </Stack>
                  </Stack>
                  <Stack direction="row" spacing={0.6} useFlexGap flexWrap="wrap" sx={{ mt: 1.2 }}>
                    {(selected.tags || []).map((tag) => <Chip key={tag} size="small" variant="outlined" label={tag} />)}
                  </Stack>
                </CardContent>
              </Card>

              <Card variant="outlined">
                <CardContent>
                  <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
                    <Box>
                      <SectionLabel>CONTENT</SectionLabel>
                      <Typography variant="h6">{selectedVersion ? 'v' + selectedVersion.versionNumber : '本文'}</Typography>
                    </Box>
                    <Stack direction="row" spacing={0.5}>
                      <Button size="small" variant="outlined" startIcon={<FeedbackIcon />} onClick={openFeedback} disabled={!selectedVersion}>採点</Button>
                      {selectedVersion && (
                        <IconButton size="small" title="本文をコピー" onClick={() => navigator.clipboard?.writeText(selectedVersion.content || selectedVersion.externalUrl || '')}>
                          <CopyIcon fontSize="small" />
                        </IconButton>
                      )}
                    </Stack>
                  </Stack>
                  {detailLoading ? <CircularProgress size={22} /> : selectedVersion ? (
                    <>
                      {selectedVersion.changeSummary && <Typography variant="caption" color="text.secondary">{selectedVersion.changeSummary} · {formatDate(selectedVersion.createdAt)}</Typography>}
                      {selectedVersion.externalUrl && <Typography component="div" sx={{ mt: 0.8, overflowWrap: 'anywhere' }}><a href={selectedVersion.externalUrl} target="_blank" rel="noreferrer">{selectedVersion.externalUrl}</a></Typography>}
                      <Box sx={{ mt: 1, p: 1.8, bgcolor: 'action.hover', borderRadius: 1, maxHeight: 520, overflow: 'auto' }}>
                        <Typography component="pre" variant="body2" sx={{
                          m: 0, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere',
                          fontFamily: selectedVersion.contentFormat === 'code' ? 'var(--p-mono)' : 'inherit',
                          lineHeight: 1.75,
                        }}>{selectedVersion.content || '本文はありません。'}</Typography>
                      </Box>
                      {(selectedVersion.promptNotes || selectedVersion.model) && (
                        <Stack direction="row" spacing={1} sx={{ mt: 1 }} useFlexGap flexWrap="wrap">
                          {selectedVersion.model && <Chip size="small" variant="outlined" label={'Model: ' + selectedVersion.model} />}
                          {selectedVersion.promptNotes && <Chip size="small" variant="outlined" label="生成条件メモあり" />}
                        </Stack>
                      )}
                    </>
                  ) : <Typography color="text.secondary" variant="body2">バージョン履歴がありません。</Typography>}
                </CardContent>
              </Card>

              <Accordion variant="outlined">
                <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                  <Typography sx={{ fontWeight: 800 }}>生成条件・タイプ別メタデータ</Typography>
                </AccordionSummary>
                <AccordionDetails>
                  {selectedVersion?.promptNotes && (
                    <Box sx={{ mb: 1.2 }}>
                      <Typography variant="caption" color="text.secondary">生成条件・プロンプト</Typography>
                      <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>{selectedVersion.promptNotes}</Typography>
                    </Box>
                  )}
                  {selectedVersion?.model && <Typography variant="body2" sx={{ mb: 1 }}>使用モデル: {selectedVersion.model}</Typography>}
                  <Typography variant="caption" color="text.secondary">メタデータ JSON</Typography>
                  <Typography component="pre" variant="body2" sx={{ mt: 0.5, p: 1.2, bgcolor: 'action.hover', borderRadius: 1, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', fontFamily: 'var(--p-mono)' }}>
                    {JSON.stringify(selected.metadata || {}, null, 2)}
                  </Typography>
                </AccordionDetails>
              </Accordion>

              <Card variant="outlined">
                <CardContent>
                  <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
                    <Box><SectionLabel>VERSION HISTORY</SectionLabel><Typography variant="h6">バージョン履歴</Typography></Box>
                    <Chip size="small" variant="outlined" label={versions.length + ' versions'} />
                  </Stack>
                  {versions.map((version) => (
                    <Box key={version.id} sx={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1,
                      p: 1, mb: 0.6, border: '1px solid', borderColor: selectedVersionId === version.id ? 'primary.main' : 'divider',
                      borderRadius: 1, cursor: 'pointer', bgcolor: selectedVersionId === version.id ? 'action.selected' : 'transparent',
                    }} onClick={() => setSelectedVersionId(version.id)}>
                      <Box sx={{ minWidth: 0 }}>
                        <Typography sx={{ fontWeight: 800 }}>v{version.versionNumber} {version.changeSummary ? '· ' + version.changeSummary : ''}</Typography>
                        <Typography variant="caption" color="text.secondary">{formatDate(version.createdAt)}</Typography>
                      </Box>
                      {version.id === selected.currentVersionId && <Chip size="small" color="primary" label="CURRENT" />}
                    </Box>
                  ))}
                </CardContent>
              </Card>

              <Card variant="outlined">
                <CardContent>
                  <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
                    <Box><SectionLabel>FEEDBACK</SectionLabel><Typography variant="h6">採点・フィードバック</Typography></Box>
                    <Chip size="small" variant="outlined" label={feedbackItems.length + ' reviews'} />
                  </Stack>
                  {feedbackItems.length === 0 ? <Typography variant="body2" color="text.secondary">まだ評価はありません。各版の「採点」から記録できます。</Typography>
                    : feedbackItems.map((entry) => (
                      <Box key={entry.id} sx={{ py: 1, borderBottom: '1px solid', borderColor: 'divider' }}>
                        <Stack direction="row" justifyContent="space-between" alignItems="center">
                          <Typography sx={{ fontWeight: 800 }}>v{entry.versionNumber} · {entry.score}/5 · {VERDICT_OPTIONS.find(([key]) => key === entry.verdict)?.[1] || entry.verdict}</Typography>
                          <Typography variant="caption" color="text.secondary">{formatDate(entry.createdAt)}</Typography>
                        </Stack>
                        {entry.feedback && <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', mt: 0.5 }}>{entry.feedback}</Typography>}
                        <Stack direction="row" spacing={0.5} useFlexGap flexWrap="wrap" sx={{ mt: 0.6 }}>
                          {Object.entries(entry.scores || {}).map(([key, value]) => <Chip size="small" variant="outlined" key={key} label={key + ': ' + value + '/5'} />)}
                          {(entry.strengths || []).map((tag) => <Chip size="small" color="success" variant="outlined" key={'s-' + tag} label={'良: ' + tag} />)}
                          {(entry.improvements || []).map((tag) => <Chip size="small" color="warning" variant="outlined" key={'i-' + tag} label={'要: ' + tag} />)}
                        </Stack>
                      </Box>
                    ))}
                </CardContent>
              </Card>
            </Stack>
          )}
        </Grid>
      </Grid>

      <Accordion variant="outlined" sx={{ mt: 2 }}>
        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
          <Typography sx={{ fontWeight: 800 }}>拡張用メタデータについて</Typography>
        </AccordionSummary>
        <AccordionDetails>
          <Typography variant="body2" color="text.secondary">
            成果物タイプは固定列挙にせず自由な文字列として保存します。曲ならジャンル・BPM・Suno Style Prompt、画像なら解像度・生成条件、動画なら尺・素材・書き出し先など、タイプ固有の情報はJSONメタデータへ追加できます。本文フォーマットもMarkdown・テキスト・JSON・コード・HTML・URLから選べます。
          </Typography>
        </AccordionDetails>
      </Accordion>

      <Dialog open={Boolean(dialog)} onClose={() => !saving && setDialog('')} fullWidth maxWidth="md">
        <Box component="form" onSubmit={(event) => { event.preventDefault(); if (dialog === 'create') createOutput(); else if (dialog === 'metadata') saveMetadata(); else if (dialog === 'version') saveVersion(); else if (dialog === 'feedback') saveFeedback(); }}>
          <CardContent sx={{ pb: 1 }}>
            <Typography variant="h6" sx={{ fontWeight: 900 }}>{dialogTitle}</Typography>
          </CardContent>
          <Divider />
          <Box sx={{ p: 2.5, display: 'grid', gap: 1.5 }}>
            {['create', 'metadata'].includes(dialog) && (
              <>
                <TextField label="タイトル" fullWidth value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} required />
                <TextField label="成果物タイプ（自由入力）" fullWidth value={draft.type} onChange={(event) => setDraft({ ...draft, type: event.target.value })} helperText="例: song / lyrics / article / image / video / code / 3d-model" />
                <TextField label="概要" fullWidth multiline minRows={2} value={draft.summary} onChange={(event) => setDraft({ ...draft, summary: event.target.value })} />
                <TextField label="タグ（カンマ区切り）" fullWidth value={draft.tagsText} onChange={(event) => setDraft({ ...draft, tagsText: event.target.value })} />
                <TextField label="メタデータ（JSON）" fullWidth multiline minRows={4} value={draft.metadataText} onChange={(event) => setDraft({ ...draft, metadataText: event.target.value })} />
              </>
            )}
            {dialog === 'create' && (
              <>
                <TextField label="本文・歌詞・コードなど" fullWidth multiline minRows={10} value={draft.content} onChange={(event) => setDraft({ ...draft, content: event.target.value })} />
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
                  <FormControl fullWidth size="small">
                    <InputLabel>本文形式</InputLabel>
                    <Select label="本文形式" value={draft.contentFormat} onChange={(event) => setDraft({ ...draft, contentFormat: event.target.value })}>
                      {FORMAT_OPTIONS.map((value) => <MenuItem value={value} key={value}>{value}</MenuItem>)}
                    </Select>
                  </FormControl>
                  <TextField label="外部URL（音声・画像・動画ファイル等）" fullWidth value={draft.externalUrl} onChange={(event) => setDraft({ ...draft, externalUrl: event.target.value })} />
                </Stack>
                <TextField label="生成条件・プロンプト" fullWidth multiline minRows={2} value={draft.promptNotes} onChange={(event) => setDraft({ ...draft, promptNotes: event.target.value })} />
                <TextField label="使用モデル" fullWidth value={draft.model} onChange={(event) => setDraft({ ...draft, model: event.target.value })} />
              </>
            )}
            {dialog === 'version' && (
              <>
                <TextField label="変更概要" fullWidth value={versionDraft.changeSummary} onChange={(event) => setVersionDraft({ ...versionDraft, changeSummary: event.target.value })} placeholder="例: サビを変更、歌詞の視点を変更" />
                <TextField label="本文" fullWidth multiline minRows={12} value={versionDraft.content} onChange={(event) => setVersionDraft({ ...versionDraft, content: event.target.value })} />
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
                  <FormControl fullWidth size="small">
                    <InputLabel>本文形式</InputLabel>
                    <Select label="本文形式" value={versionDraft.contentFormat} onChange={(event) => setVersionDraft({ ...versionDraft, contentFormat: event.target.value })}>
                      {FORMAT_OPTIONS.map((value) => <MenuItem value={value} key={value}>{value}</MenuItem>)}
                    </Select>
                  </FormControl>
                  <TextField label="外部URL" fullWidth value={versionDraft.externalUrl} onChange={(event) => setVersionDraft({ ...versionDraft, externalUrl: event.target.value })} />
                </Stack>
                <TextField label="生成条件・プロンプト" fullWidth multiline minRows={2} value={versionDraft.promptNotes} onChange={(event) => setVersionDraft({ ...versionDraft, promptNotes: event.target.value })} />
                <TextField label="使用モデル" fullWidth value={versionDraft.model} onChange={(event) => setVersionDraft({ ...versionDraft, model: event.target.value })} />
              </>
            )}
            {dialog === 'feedback' && (
              <>
                <Typography variant="body2" color="text.secondary">対象: {selected?.title} / v{selectedVersion?.versionNumber}</Typography>
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
                  <FormControl fullWidth size="small">
                    <InputLabel>総合点</InputLabel>
                    <Select label="総合点" value={feedbackDraft.score} onChange={(event) => setFeedbackDraft({ ...feedbackDraft, score: event.target.value })}>
                      {[1, 2, 3, 4, 5].map((value) => <MenuItem key={value} value={String(value)}>{value} / 5</MenuItem>)}
                    </Select>
                  </FormControl>
                  <FormControl fullWidth size="small">
                    <InputLabel>判定</InputLabel>
                    <Select label="判定" value={feedbackDraft.verdict} onChange={(event) => setFeedbackDraft({ ...feedbackDraft, verdict: event.target.value })}>
                      {VERDICT_OPTIONS.map(([key, label]) => <MenuItem key={key} value={key}>{label}</MenuItem>)}
                    </Select>
                  </FormControl>
                </Stack>
                <TextField label="観点別スコア（JSON・各1〜5点）" fullWidth multiline minRows={3} value={feedbackDraft.scoresText} onChange={(event) => setFeedbackDraft({ ...feedbackDraft, scoresText: event.target.value })} helperText={'曲の例: {"lyrics": 4, "melody": 3, "originality": 5, "personalFit": 4}'} />
                <TextField label="感想・評価理由" fullWidth multiline minRows={3} value={feedbackDraft.feedback} onChange={(event) => setFeedbackDraft({ ...feedbackDraft, feedback: event.target.value })} />
                <TextField label="良かった点（カンマ区切り）" fullWidth value={feedbackDraft.strengthsText} onChange={(event) => setFeedbackDraft({ ...feedbackDraft, strengthsText: event.target.value })} />
                <TextField label="改善点（カンマ区切り）" fullWidth value={feedbackDraft.improvementsText} onChange={(event) => setFeedbackDraft({ ...feedbackDraft, improvementsText: event.target.value })} />
              </>
            )}
          </Box>
          <Divider />
          <Stack direction="row" justifyContent="flex-end" spacing={1} sx={{ p: 2 }}>
            <Button onClick={() => setDialog('')} disabled={saving}>キャンセル</Button>
            <Button type="submit" variant="contained" startIcon={saving ? <CircularProgress size={16} /> : <SaveIcon />} disabled={saving}>
              保存
            </Button>
          </Stack>
        </Box>
      </Dialog>
    </Box>
  );
}
