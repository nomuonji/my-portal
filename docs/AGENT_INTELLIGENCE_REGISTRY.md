# Legacy Agent Intelligence Registry — compatibility only

**Current conceptual model**: Agent Profile, Skill Pack, Skill. *Intelligence* describes the nature of a Skill or Pack; it is **not** a fourth capability or an independent cognitive registry. The definitive architecture is [AGENT_ARCHITECTURE.md](AGENT_ARCHITECTURE.md).

## Existing physical data and provenance

- `agentProfiles` + immutable `agentProfileVersions`: retain the default agent identity, principles, boundaries and available capabilities.
- `chatSkills` + immutable `chatSkillVersions`: canonical individual Skills, including `skillType=intelligence` as an ordinary subtype. The Dojo may pin approved versions.
- `skillPacks` + immutable `skillPackVersions`: canonical Skill Pack workflow manifests for new definitions. `viral-post-pack` continues to reference its original coordinator Skill and Dojo.
- `intelligencePacks` + immutable `intelligencePackVersions`: historical storage for the seven old Intelligences. These IDs, versions, owner feedback and historical records **must not be destroyed**.

The existing `intelligence_pack_get/list/version_*`, `intelligence_get/list`, and `cognitive_bundle_resolve` endpoints remain compatibility APIs. They do not imply a separate kind of intelligence runtime and should not be used for new capability taxonomy.

## Migration of historical composite records

The four historical composites are projected as Skills Packs in `skill_pack_list/get` without duplicating their live text:

- `marketing-creative-cognition` → Intelligence-type Skill Pack
- `monetization-intelligence` → workflow Skill Pack
- `youtube-view-growth-intelligence` → workflow Skill Pack
- `video-production-intelligence` → workflow Skill Pack

The projection maps each original component to a named Pack stage and each `chat_skill` dependency to a reference (not a copied Skill body). Original worldview, reasoning procedures, criteria, failure modes, and versions remain readable as Pack instructions through the historical snapshot.

For `skill_pack_get(resolve=true)`, the original Dojo's released version is respected, even when Registry latest is newer; each member Skill also loads its own Dojo-approved body. No UI navigation path is proof of a new approval or higher effectiveness.

## Retiring standalone Intelligence

- `treasure-keyword-intelligence`, `human-md-creative-intelligence`: Intelligence **Skills**, using the normal Chat Skill lifecycle.
- `exploration-operations`: shared exploration/Dojo procedure **Skill**, rather than an Intelligence.
- Any old record promoted to canonical Chat Skill must retain source ID/version provenance; never blindly overwrite an existing Skill or erase past versions. A cognitive principle already in an existing Skill should not be redundantly copied.
- The original three workflow Dojos currently refer to `intelligence_pack` targets. A lossless reclassification operation is available to change those pointers to `skill_pack` only after the destination's exact historical approved version has been verified and there is no open run. It does **not** call `exploration_method_version_set`, consume human ratings, or make a fake new release.

## Runtime selection

A calling agent reads one Agent Profile, chooses only the relevant Skill Pack(s) and individual Skills, and uses the minimum needed tools. Some Skills are cognitive, others operational; both can think, decide and generate. A Pack's Intelligence specialization is not a permission or behavioral mode.

The legacy `cognitive_bundle_resolve` assembles historical references only. It must not silently override Dojo releases, fetch external data or run tools. Missing requirements are explicit gaps. Agent HQ owns actual tasks, execution, approvals and external side effects.