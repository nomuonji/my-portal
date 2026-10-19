# My Portal design system — "operations ledger"

My Portal is a personal work desk: projects, thinking themes, agent queues and leisure discovery in one place. The UI should read like a well-kept ledger, not a marketing dashboard.

## Principles

- **Paper and ink.** Neutral paper surfaces (`bg`, `surface`, `sunken`) with ink text. No decorative gradients, glass blur, or floating card shadows. Structure comes from 1px hairline rules (`rule`, `ruleStrong`).
- **One accent.** Vermilion (`accent`) marks selection, state, focus and primary text actions. Primary *contained* buttons are ink in light mode (accent in dark mode) so the accent stays rare.
- **Monospace for metadata.** Dates, counts, IDs, index numbers and section eyebrows use `fonts.mono` (JetBrains Mono). Content and headings use Noto Sans JP.
- **Numbers are an index, not a hero.** Show counts as one quiet mono line rather than big vanity tiles.
- **Dedicated worlds are allowed.** `/discover` and `/taste` keep their own dark editorial panels; the shell around them stays consistent.

## Tokens

Defined in `src/theme.js` (`tokens.light`, `tokens.dark`) and exposed at runtime as `theme.palette.portal`.

| token | role |
| --- | --- |
| `bg` | app background |
| `surface` | cards, inputs, selected nav row |
| `sunken` | drawer (dark), progress tracks |
| `ink` / `muted` / `faint` | text primary / secondary / disabled |
| `rule` / `ruleStrong` | hairlines / input borders |
| `accent` / `accentSoft` | selection, focus ring, text actions |
| `teal` | secondary palette color |

Shape radius is 6px. Section eyebrows use `variant="overline"` (mono, uppercase) in the form `01 — Find the owner`.

## Shell

- Sidebar: brand block, then grouped single-line navigation — 入口 / 自分 / エージェント / 制作・公開 / ほか. Long descriptions live in the row's `title` tooltip, not as wrapped secondary text.
- Header: `MY PORTAL / <page>` breadcrumb on desktop, today's date (JST) in mono on the right, unread counter.
- Signed-out state shows a real sign-in screen with the Google button (previously only reachable from the drawer).
- Mobile keeps the five-tab bottom navigation; the selected tab gets a 2px accent bar.

## Home

Date line → time-of-day greeting → six-way launcher to the places opened daily (寄り道, ボード, 思考テーマ, 好みの記録, Agent HQ, プロジェクト提案) → index line → map search (sticky on desktop) → Agent Guide, routes, Projects, Skills, Contexts.
