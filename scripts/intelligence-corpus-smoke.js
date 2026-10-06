const assert = require('node:assert/strict');
const corpus = require('../functions/intelligenceCorpusStore');

const fixture = `
<html><body>
<ul>
<li><span>【第92回】2026.9.27 放送</span><a href="/murakamiradio/report/99655">村上RADIO～くたばれ、アカデミー賞～</a></li>
<li><span>【第20回】2020.12.31-2021.1.1 放送</span><a href="/murakamiradio/toshikoshisp2020/">年越しスペシャル～牛坂21～</a></li>\n<li><span>【第1回】2018.8.5 放送</span><a href="/murakamiradio/index_20180805.html">～RUN & SONGS～</a></li>
</ul>
<main><p>こんばんは、村上春樹です。</p><p>段落を残します。</p></main>
</body></html>`;

const links = corpus.discoverMurakamiRadioLinks(fixture);
assert.equal(links.length, 3);
assert.deepEqual(links.map((item) => item.episodeNumber), [92, 20, 1]);
assert.deepEqual(links.map((item) => item.broadcastDate), ['2026-09-27', '2020-12-31', '2018-08-05']);
assert.equal(links[0].url, 'https://www.tfm.co.jp/murakamiradio/report/99655');
assert.equal(links[1].url, 'https://www.tfm.co.jp/murakamiradio/toshikoshisp2020/');\nassert.equal(links[2].url, 'https://www.tfm.co.jp/murakamiradio/index_20180805.html');
assert.equal(corpus.sourceDocId(links[0].url), 'murakami_radio_report_99655');
assert.equal(corpus.sourceDocId(links[1].url), 'murakami_radio_toshikoshisp2020');\nassert.equal(corpus.sourceDocId(links[2].url), 'murakami_radio_20180805');
assert.match(corpus.extractDerivedText(fixture), /こんばんは、村上春樹です。\n\n?段落を残します。/);
assert.equal(corpus.canonicalMurakamiUrl('https://example.com/murakamiradio/report/1'), null);
console.log('intelligence corpus smoke: ok');
