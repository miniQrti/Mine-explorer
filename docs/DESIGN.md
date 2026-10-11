# Mine Explorer — initial design

## Product

Working name: Mine Explorer. The user selected the public repository `miniQrti/Mine-explorer` for browser test-page hosting, superseding the earlier private-repository preference. GitHub Pages still needs a playable build and hosting configuration; public repository visibility alone does not create a test page.

A responsive browser game for desktop, phones, and tablets. The player uses classic Minesweeper deduction to uncover an irregular cave, locate hidden stairs, and descend indefinitely. No character movement system, combat, equipment, power-ups, or special abilities are part of the initial game.

## Core rules

1. Each floor is a square-cell grid with an irregular playable footprint. Solid, indestructible rock shapes chambers and passages.
2. Each floor begins with a small safe, revealed entrance area that provides a logical starting point.
3. Floor 1 starts at one end of the map. Later floors may start near the middle, allowing exploration in several directions.
4. The player can reveal a covered tile only if it touches revealed ground, horizontally, vertically, or diagonally.
5. The eligible frontier appears as covered tiles. The rest of the cave remains concealed by fog of war, including its overall silhouette and stair location.
6. Revealed ground displays the count of mines in all eight neighboring positions. Solid rock cannot contain mines. Mine counts are based on neighboring cells, not lines of sight through rock.
7. Revealing a zero automatically opens its connected zero region and bordering safe numbered tiles, as in classic Minesweeper. This expands exploration naturally. Flood reveal respects flags and solid rock.
8. Players can place and remove flags on covered frontier tiles. Flags are notes, not a requirement for success.
9. Every floor contains a hidden safe stair tile. Revealing it enables descent without clearing other safe tiles or flagging all mines.
10. Hitting a mine ends the current attempt according to the selected mode.

Rock becomes visible next to explored ground, establishing the boundary of the usable frontier. Revealing rock does not create explored ground from which further tiles can be opened.

## Modes

| Mode | Consequence of hitting a mine |
| --- | --- |
| Expedition | Return to floor 1 with a freshly generated map. |
| Floor retry | Retry the same floor number with a freshly generated map. |

Both modes use the same puzzle rules and generation guarantees. Keep depth records separate because the modes measure different accomplishments.

## Fresh generation and fairness

Every descent and every retry generates a new cave layout, mine arrangement, and stair placement. Do not reuse a fixed depth-to-map sequence or a previously failed map as the retry. Reproducible seeds may be used internally for debugging, but player attempts must obtain fresh seeds.

Every delivered floor must have a route to discovering the stairs that requires no guessing. A traversable safe path alone does not meet this requirement.

Validate a candidate by simulating a player from the initial revealed area:

- The deduction engine receives only information available to a player: revealed clues, visible terrain, established deductions, and frontier eligibility.
- It must not use the hidden solution, unseen terrain, undisclosed total mine count, or unrevealed stair location to choose safe moves.
- It can infer mines and safe cells from visible constraints, but reveals must obey the same eight-neighbor frontier restriction as real play.
- Apply actual zero flood reveal behavior while simulating progress.
- Accept the candidate only when legal, proven-safe reveals discover the stairs.
- Reject candidates that stall, exceed validation limits, or fail the current difficulty bounds. A timeout is not evidence of solvability.
- Never silently fall back to an unvalidated floor. If generation is exhausted, retry generation and show a recoverable loading state.

Optional areas may remain ambiguous. The guarantee concerns discovering the descent, not solving every cell. Player mistakes, including incorrect flags, remain possible.

The validator's permitted deduction techniques and complexity limits must be explicit so difficulty reflects actual reasoning, not just mine count. Begin with understandable local deductions and overlapping clue constraints; measure generation performance before increasing complexity.

## Endless progression

There is no final floor. Difficulty varies within bands whose ceilings rise at major milestones.

Initial band structure discussed:

| Floors | Intended progression |
| --- | --- |
| 1–100 | Gradually introduce harder puzzles up to the initial cap. |
| 101–200 | Vary puzzles within that cap. |
| 201–300 | Raise the ceiling and gradually introduce harder puzzles. |
| 301–400 and subsequent hundred-floor bands | Repeat the milestone pattern. |

Tune difficulty using deduction complexity, mine density, cave branching, and moderate map growth. Every floor need not be harder than the previous one. Cave dimensions need a practical independent maximum to keep navigation manageable, particularly on phones.

Exact density values, dimensions, reasoning limits, and progression curves are implementation and playtesting decisions. At extreme depth, preserve fairness, performance, and readable maps rather than allowing unbounded density or solver complexity.

Floor retry retains the current difficulty band. Expedition reset returns to introductory difficulty.

## Input and viewport

| Device | Reveal | Toggle flag | Navigate |
| --- | --- | --- | --- |
| Desktop | Left-click | Right-click | Drag to pan; provide zoom controls |
| Phone/tablet | Tap | Long-press | Drag to pan; pinch to zoom |

- Resolve taps on release, after distinguishing them from dragging and long-pressing.
- A completed long-press must not also trigger a reveal on release.
- Dragging, pinching, canceled gestures, and additional touch pointers must never reveal a tile accidentally.
- Allow panning into nearby fog without exposing the hidden cave outline or stair location.
- Maintain comfortably sized tiles; scroll large caves instead of shrinking the whole map onto the screen.
- Support portrait and landscape orientations with a compact interface and readable floor/depth displays.
- Prevent the browser context menu from interrupting board flagging while preserving ordinary browser behavior outside the board.

## Visual and audio direction

Use a top-down square grid with crisp pixel-art styling:

- Pale stone revealed tiles and high-contrast classic colored numerals.
- Dark stone covered tiles around the accessible frontier.
- Rough basalt outcrops for solid rock.
- Copper-red flags for suspected mines.
- Deep fog beyond explored terrain.
- Small warm lantern accents at entrances and revealed stairs.
- Restrained interface showing mode, current floor, best depth, and settings.

Lighting must never impair number readability or reveal hidden gameplay information. The approved concept in `concept.png` is a mood and layout reference, not a mechanically valid board or a game asset sheet.

Suggested audio: subtle stone clicks, distant water, and a short descent cue. Sound should be optional and compatible with mobile browser gesture requirements.

## First implementation sequence

1. **Rules and generation:** cell state, rock boundaries, eight-neighbor frontier, flags, clues, flood reveal, safe starts, hidden stairs, fresh randomness, and the fair-play validator.
2. **Playable interface:** readable cave board, fog, desktop and touch input, pan/zoom, stair transition, mine failure, both modes, and depth progression.
3. **Visual polish and balancing:** lantern-lit art treatment, optional sound, separate depth records, responsive layout, generation performance, and difficulty bands.

Build the fairness mechanism early because it constrains cave generation and progression. Do not claim a no-guessing guarantee based only on a few manually played boards.

## Acceptance checks for implementation

- Reveals outside the frontier have no effect; diagonal frontier reveals work.
- Mine counts include all eight neighboring cells; rock never contributes a mine.
- Zero expansion stops correctly at numbered cells, flags, and rock.
- Hidden terrain and stairs remain concealed until exploration exposes them.
- Stairs can be reached without clearing the floor or identifying every mine.
- Each mode applies the correct depth change and generates a fresh attempt.
- Generated floors have a verified deduction trace that obeys the player-visible rules.
- Multiple seeds across each difficulty band pass validation; failed or timed-out candidates never reach play.
- Controls work on desktop and touch devices without gesture-triggered accidental reveals.
- Portrait and landscape layouts preserve readable clues and comfortable interaction.

These checks describe future implementation validation. No playable build or automated test results exist yet.
