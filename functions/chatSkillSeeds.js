/* Initial migration payloads only. Each is persisted to chatSkills by bootstrapSkills();
 * post-migration My Portal DB is authoritative. Edits in Portal do NOT overwrite from these seeds. */
module.exports = [
 require('./chatSkillSeeds/human-web-voice.json'),
 require('./chatSkillSeeds/site-originality-studio.json'),
 require('./chatSkillSeeds/idea-resonance-lab.json'),
 require('./chatSkillSeeds/creative-thinking.json'),
 require('./chatSkillSeeds/murakami-radio-thinking.json'),
 require('./chatSkillSeeds/creative-market-discovery.json'),
 require('./chatSkillSeeds/character-visual-design.json'),
 require('./chatSkillSeeds/lateral-discovery-drill.json'),
 require('./chatSkillSeeds/tweet-to-youtube-essay.json'),
 require('./chatSkillSeeds/world-home-navigation.json'),
 require('./chatSkillSeeds/public-content-publishing.json'),
];
