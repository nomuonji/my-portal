'use strict';
// Snapshot from the user's publicly visible Filmarks lists on 2026-10-18.
// Source: https://filmarks.com/users/postmodern137/clips?page=1, page=2,
// and https://filmarks.com/users/postmodern137 (8 personal Marks).
// International film titles are search hints, not proof of identity.
// Resolver requires matching source YEAR plus normalized canonical title.
const clips=[
 ['シラート',2025,['Sirat','Sirât']],
 ['Shall we Dance? シャル・ウィ・ダンス?',2004,['Shall We Dance?','Shall We Dance']],
 ['時計じかけのオレンジ',1971,['A Clockwork Orange']],
 ['胎児が密猟する時',1966,['The Embryo Hunts in Secret','Embryo Hunts in Secret']],
 ['ジョジョ・ラビット',2019,['Jojo Rabbit']],
 ['テリー・ギリアムのドン・キホーテ',2018,['The Man Who Killed Don Quixote']],
 ['40歳の童貞男',2005,['The 40 Year Old Virgin','The 40-Year-Old Virgin']],
 ['ロベルト・ベニーニの Mr.モンスター',1994,['The Monster','Il Mostro']],
 ['トゥモローランド',2015,['Tomorrowland']],
 ['バック・トゥ・ザ・フューチャー',1985,['Back to the Future']],
 ['ビューティフル・マインド',2001,['A Beautiful Mind']],
 ['ポンヌフの恋人 4Kレストア版',1991,['The Lovers on the Bridge','Les Amants du Pont-Neuf']],
 ['アニマル・ハウス',1978,['Animal House',"National Lampoon's Animal House"]],
 ['FRANK ーフランクー',2014,['Frank']],
 ['ブルース・ブラザース',1980,['The Blues Brothers']],
 ['イディオッツ',1998,['The Idiots','Idioterne']],
 ['裸の銃を持つ男',1988,['The Naked Gun: From the Files of Police Squad!','The Naked Gun']],
 ['裸の銃を持つ男',2025,['The Naked Gun']],
 ['裸の銃を持つ男2 1／2',1991,['The Naked Gun 2½: The Smell of Fear','The Naked Gun 2 1/2: The Smell of Fear']],
 ['落下の王国 4Kデジタルリマスター',2006,['The Fall']],
 ['ビッグ・リボウスキ',1998,['The Big Lebowski']],
 ['悪魔の毒々モンスター',1984,['The Toxic Avenger']],
 ['レニングラード・カウボーイズ・ゴー・アメリカ',1989,['Leningrad Cowboys Go America']],
 ['レニングラード・カウボーイズ、モーゼに会う',1994,['Leningrad Cowboys Meet Moses']],
 ['ラヴィ・ド・ボエーム',1992,['La Vie de Bohème','La Vie de Boheme']],
 ['PERFECT BLUE',1997,['Perfect Blue']],
 ['ヒミズ',2011,['Himizu']],
 ['キッドナップ・ブルース',1982,['Kidnap Blues']],
 ['真昼の決闘',1952,['High Noon']],
 ['ドラゴン・タトゥーの女',2011,['The Girl with the Dragon Tattoo']],
 ['女は二度決断する',2017,['In the Fade']],
 ['サルトルとボーヴォワール 哲学と愛',2006,['Les Amants du Flore','The Lovers of the Flore']],
 ['乱暴と待機',2010,['Vengeance Can Wait']],
 ['ファーゴ',1996,['Fargo']],
 ['地獄の黙示録',1979,['Apocalypse Now']],
 ['ディア・ハンター',1978,['The Deer Hunter']],
 ['浮雲',1955,['Floating Clouds']],
 ['正義の行方',2024,['The Path of Justice','The Whereabouts of Justice']],
 ['全身小説家',1994,['A Dedicated Life']],
 ['我輩はカモである',1933,['Duck Soup']],
 ['首',2023,['Kubi','Neck']],
 ['めくらやなぎと眠る女',2022,['Blind Willow, Sleeping Woman']],
 ['HOW TO HAVE SEX',2023,['How to Have Sex']],
 ['大いなる不在',2023,['Great Absence']]
];
const marks=[
 ['浮き雲',1996,['Drifting Clouds'],5.0],
 ['西部戦線異状なし',1930,['All Quiet on the Western Front'],3.8],
 ['静かなる男',1952,['The Quiet Man'],3.6],
 ['勝手にしやがれ',1960,['Breathless','À bout de souffle'],3.6],
 ['太陽を盗んだ男',1979,['The Man Who Stole the Sun'],3.9],
 ['タクシードライバー',1976,['Taxi Driver'],3.5],
 ['お熱い夜をあなたに',1972,['Avanti!'],3.8],
 ['気狂いピエロ',1965,['Pierrot le Fou'],5.0]
];
function items(){
 return [
  ...clips.map(([title,year,aliases],i)=>({id:'clip-'+String(i+1).padStart(2,'0'),source:'clip',title,year,aliases,
    url:'https://filmarks.com/users/postmodern137/clips?page='+(i>=36?'2':'1')})),
  ...marks.map(([title,year,aliases,score],i)=>({id:'mark-'+String(i+1).padStart(2,'0'),source:'mark',title,year,aliases,score,sourceScoreMax:5,
    url:'https://filmarks.com/users/postmodern137'}))
 ];
}
if(clips.length!==44||marks.length!==8)throw Error('Filmarks snapshot unexpectedly incomplete');
module.exports={items,clips,marks};
