const assert = require('node:assert/strict');
const corpus = require('../functions/intelligenceCorpusStore');

const fixture = `
<html><body>
<ul>
<li><span>【第92回】2026.9.27 放送</span><a href="/murakamiradio/report/99655">村上RADIO～くたばれ、アカデミー賞～</a></li>
<li><span>【第20回】2020.12.31-2021.1.1 放送</span><a href="/murakamiradio/toshikoshisp2020/">年越しスペシャル～牛坂21～</a></li>
<li><span>【第1回】2018.8.5 放送</span><a href="/murakamiradio/index_20180805.html">～RUN & SONGS～</a></li>
</ul>
<section class="bnArea"><div><p>画像だけの短い見出し。</p></div></section>
<section class="bnArea"><div><p>こんばんは、村上春樹です。</p><p>段落を残します。</p><p>こちらが本文です。</p></div></section>
</body></html>`;

const links = corpus.discoverMurakamiRadioLinks(fixture);
assert.equal(links.length, 3);
assert.deepEqual(links.map((item) => item.episodeNumber), [92, 20, 1]);
assert.deepEqual(links.map((item) => item.broadcastDate), ['2026-09-27', '2020-12-31', '2018-08-05']);
assert.equal(links[0].url, 'https://www.tfm.co.jp/murakamiradio/report/99655');
assert.equal(links[1].url, 'https://www.tfm.co.jp/murakamiradio/toshikoshisp2020/');
assert.equal(links[2].url, 'https://www.tfm.co.jp/murakamiradio/index_20180805.html');
assert.equal(corpus.sourceDocId(links[0].url), 'murakami_radio_report_99655');
assert.equal(corpus.sourceDocId(links[1].url), 'murakami_radio_toshikoshisp2020');
assert.equal(corpus.sourceDocId(links[2].url), 'murakami_radio_20180805');
const derived = corpus.extractDerivedText(fixture);
assert.match(derived, /こんばんは、村上春樹です。\n\n?段落を残します。/);
assert.match(derived, /こちらが本文です。/);
assert.doesNotMatch(derived, /画像だけの短い見出し。/);
assert.doesNotMatch(derived, /第92回/);
assert.equal(corpus.canonicalMurakamiUrl('https://example.com/murakamiradio/report/1'), null);
console.log('intelligence corpus smoke: ok');
