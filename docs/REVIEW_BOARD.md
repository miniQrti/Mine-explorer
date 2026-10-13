# Mine Explorer review board

**Status:** three specialist review and improvement rounds completed. No known release-blocking findings remain. Deployment and live gameplay verification passed.

**[Play Mine Explorer](https://miniqrti.github.io/Mine-explorer/)**

[GitHub review issue](https://github.com/miniQrti/Mine-explorer/issues/1) · [Repository](https://github.com/miniQrti/Mine-explorer) · [Desktop screenshot](screenshots/desktop.png) · [Mobile screenshot](screenshots/mobile.png)

## Board

| ID | Found | Area | Finding / improvement | Owner | Status | Verification |
| --- | --- | --- | --- | --- | --- | --- |
| GEN-1 | Round 1 | Gameplay | Entrance flood clears almost the whole cave; some exits take one click | Engine specialist | Done | Opening ≤60%; reject one-click exits; minimum 3–7 proof actions; independent 2,000-floor retest |
| HELP-1 | Round 1 | Mobile UX | Dismissing field notes removes mobile Help access | Interface specialist | Done | Persistent Help; small-screen browser regressions |
| NOTE-1 | Round 1 | Design | Mobile onboarding obscures clues and joins heading words | Interface specialist | Done | Compact note, corrected spacing; rendered review |
| TOUCH-1 | Round 1 | Accessibility | Some touch targets smaller than comfortable 44px | Interface specialist | Done | 44px coarse-pointer controls; portrait/landscape review |
| SAVE-1 | Round 1 | Robustness | Malformed null save entries interrupt restore | Interface specialist | Done | Defensive action guards and exact normal-run restore checks |
| WORKER-2 | Round 2 | Recovery | Retry after worker-load error reuses failed worker | Interface specialist | Done | Terminate/reset worker; network-abort/retry regression; independent second-worker probe |
| GESTURE-2 | Round 2 | Mobile UX | Harden long-press context menus and second touches on controls | Interface specialist | Done | Pending reveal canceled; true Chromium touch regression |
| REG-3 | Round 3 | Release | Expanded gameplay, persistence, and responsive regression | Independent reviewers | Done | 15 engine tests; 36 browser passes, 2 intentional skips; WebKit desktop/mobile pass |
| DEPLOY-3 | Round 3 | Hosting | Verify workflow and actual published game | Project lead | Done | Actions passed; live desktop/mobile DOM-only puzzle solving, descent, Help, assets, and JS errors checked |
| FOCUS-NEXT | Future polish | Keyboard UX | Automatically focus board after retry/descent | Backlog | Optional | Current Tab navigation works; no blocked action |

## Round 1 — first playable build

**Reviewers:** independent gameplay/code specialist, browser QA specialist, visual/UX specialist; engine and interface specialists applied fixes.

- Independent 480-floor checking found no false safe/mine deductions.
- A 2,000-floor balance probe found excessive opening floods and one-click descents. For example, `balance-1-26` originally revealed 96 of 103 safe tiles at startup.
- Generation now rejects opening floods over 60% of safe terrain, any initial-frontier reveal exposing stairs immediately, and proof traces shorter than 3 actions (rising to 7 in higher bands). An independent 2,000-floor retest verified these bounds with no generation failures.
- First browser run: **20 passed, 3 failed, 1 intentional desktop touch skip**. The failures exposed mobile Help disappearing after onboarding dismissal.
- Visual review at 1440×1000, 390×844, 320×568, and 844×390 found the Help issue, oversized onboarding, joined heading words, and undersized touch targets. Fixes landed before the next review.

## Round 2 — recovery, persistence, and revised UX

- Rendered review confirmed accessible Help, compact onboarding, correct spacing, and 44px touch targets.
- Added exact saved seed/depth/mode/reveals/flags reload checks, failed-worker retry, and `/Mine-explorer/` asset/worker-path tests.
- Browser QA and the code reviewer independently reproduced a worker-network failure where retry stayed stuck. The error handler now destroys the failed worker so retry creates a new one. Generation failures keep board actions locked until recovery.
- Post-fix browser result: **29 passed, 1 intentional desktop touch skip, no failures**.
- Visual review checked dialog focus restoration, floor 10001 counters at 320px width, mine loss/retry, and successful descent. No new blocking design findings remained.

## Round 3 — final independent regression

- **Engine:** **15 tests passed**, including exhaustive small-board deduction checking, fog sanitization, flag/flood/frontier rules, generation rejection, difficulty boundaries, and 320 generated-floor proof traces.
- **Independent gameplay audit:** 40 additional floors at depths 1, 200, 201, and 10000; **1,113 visible states and 32,016 safe/mine assertions** checked. User flags did not alter deductions; no incorrect deductions found.
- **Lifecycle audit:** aborted worker request recovered through a second worker; overlapping generation requests installed only the latest floor; death persisted across reload; floor retry retained depth 201 with a fresh seed. No uncaught JavaScript errors.
- **Chromium browser suite:** **36 passed, 2 intentional desktop-only touch skips, 0 failures**. Expanded checks cover diagonal-only frontier access, arrows/F/Enter/Escape and focus restoration, bounded zoom, a second touch starting on controls, and JavaScript-error assertions during normal gameplay.
- **WebKit:** desktop and iPhone 13 emulation passed actual module-worker generation, native click/right-click/tap, flags, exact save/restore, help/settings, reduced-motion persistence, logical descent, both retry modes, and three responsive sizes. No uncaught JavaScript errors.
- **Final visual review:** desktop, 320px portrait, and 667×375 landscape remained readable; deep counters, loss/exit panels, and focused actions fit. A clipped screenshot was traced to the test harness auto-scrolling an offscreen focused tile, not the app's preventScroll keyboard flow.

## Scope and evidence

- [Validation and deployment workflow](https://github.com/miniQrti/Mine-explorer/actions/runs/38303611188) succeeded for game commit `9e67c88`.
- The actual published URL passed desktop and mobile production checks with no QA harness: clues were read directly from rendered tiles, used to deduce safe moves (21 desktop moves and 8 mobile moves on independently generated floors), and followed through stairs to floor 2. Help worked; no failed assets or uncaught JavaScript errors were observed.

- Each delivered floor is validated using the same visible clues/frontier available to the player. Failed, stalled, trivial, or timed-out candidates are never delivered as fallback puzzles.
- Tests are in `tests/engine.test.js`, `tests/browser.spec.js`, `tests/qa-helpers.js`, and `tests/webkit-smoke.mjs`.
- Mobile checks use device emulation, not physical iPhone/Android certification. Native long-press/pinch/cancel input was covered through Chromium; WebKit covered native taps and the broader gameplay flow.
- The GitHub Pages workflow runs engine and Chromium browser tests before building and deploying. Local WebKit smoke is supplemental.
- The optional keyboard-focus polish is tracked separately from completed release requirements.

## Player feedback update — 2026-10-13

The first-floor entrance was visually ambiguous, new floors showed too much safe ground, and the symbol meanings were unclear.

| Finding | Change | Validation |
| --- | --- | --- |
| Entrance hard to identify | Gold ENTRY label and timber entrance icon; camera starts at the entrance; entrance control returns the view there | Desktop/mobile tests at depths 1, 17, 201 plus rendered portrait/landscape review |
| Starting area too large | New floors reveal 9–16 safe cells; first entrance sits at the cave edge with rock behind it | 320 proof replays also reconstruct ordinary zero-flood behavior independently; no artificial flood cutoff |
| Missing symbol guide | Persistent Legend button and Help link explain all nine symbols | Actual icon parity, both opening routes, scrolling and closing on narrow touch screens |
| Save compatibility after generation change | Versioned generation preserves exact old progressed boards; untouched old openings adopt compact generation | Five historical whole-floor/proof hashes; exact old/new browser save-reload regressions |
| Mobile resize moved the camera away from ENTRY | Viewport resize preserves the viewed map point and zoom, including when rotating a phone | Independent reproduction and fix review; desktop/mobile orientation, pan/zoom, and queued-resize regressions |
| Ambiguous starting instructions | Direct players to covered tiles along the explored edge, rather than already-open entrance neighbors | Specialist design review finding applied |

Results: **16 engine tests passed; 50 Chromium desktop/mobile browser tests passed, 2 intentional desktop touch skips; no unexpected JavaScript errors.** The engine specialist also generated 500 compact floors across depth bands without failure (maximum observed generation time 33 ms). Existing fairness, gesture safety, failure modes, descent, and worker recovery checks still pass.

A supplemental WebKit rerun could not launch after the environment reset removed its temporary native libraries. The original release's WebKit results above remain historical; this update's executed mobile regression coverage is Chromium emulation plus rendered UX review.

Updated screenshots: [desktop](screenshots/desktop.png), [mobile](screenshots/mobile.png), [legend](screenshots/legend.png). [Deployment workflow](https://github.com/miniQrti/Mine-explorer/actions/runs/38384483701) passed for `fe99ab7`.

The published game passed fresh desktop and Pixel 7 emulation checks: centered ENTRY, 14/16-tile openings, all nine legend symbols, and visible-clue-only play to floor 2 (30/15 moves), with no uncaught JavaScript errors. Mobile portrait/landscape rotation retained entrance centering. Three additional fresh mobile loads also kept ENTRY centered after the initial resize settled.
