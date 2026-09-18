# Family Circle — Card Game

A private, pass-and-play family card & quiz game for 2–7 players, built to
match the agreed **Family Circle Rule Sheet** and **Card & Power
Reference** exactly where those sheets are explicit, and clearly flagged
wherever they left something open.

This is a **testing build** — playtest it locally, and with the family,
before treating it as final. See "Open rule questions" below for the
handful of judgement calls made to fill genuine gaps in the sheets, and
adjust the in-app house-rule settings (or ask for a code change) once
you've agreed them.

## What's implemented

- 2–7 players, individual play or Teams (2v2 with 4 players, 3v3 with 6
  players — see the 4v4 note below).
- The full question system: 4 topic questions + **Ask Your Own Question**
  (Family Question) each turn, three-answer multiple choice, 1 point for
  a correct answer.
- Card runs that connect forward or backward, reverse mid-run, and change
  suit on a matching rank — exactly per the rule sheet's connection rule.
- All eight power effects from the Card & Power Reference: Ace (wild,
  playable any time, choose next suit), 2 (+2 pickup, stacks), 7
  (reverses direction, may finish on it), 8 (skips, stackable, cancels an
  active skip), Red Jack (cancels a pending pickup), Black Jack (+5
  pickup, stacks with 2s).
- Power cards buried inside a run stay inert; only the exposed/final card
  of a run activates its power (with 8/2/Black Jack stacking honoured
  when a run ends in a same-rank group of them, per the sheets).
- Draw-when-stuck, and the discard pile flips over (unshuffled) as the
  new draw pile once the deck runs out, exactly as written.
- A round ends the moment someone legally clears their hand; going out on
  a power card (other than a 7) is blocked.
- A green-felt, gold-trimmed table and the Family Circle badge, based on
  the reference logo and table artwork you supplied.

## Open rule questions (please confirm)

The recovered rule sheet intentionally left some things unlocked rather
than guessing standard card-game rules. This build had to make a few
small, clearly-flagged calls to be playable — please treat these as
proposals, not final rules:

1. **What a card must match to be led.** The sheet defines how cards
   *connect within a run*, but not what makes the first card of a play
   legal against the discard pile. This build applies the same
   connection rule (same suit + sequential rank, or same rank + different
   suit) to the pile too — an Ace is the documented exception and can
   always be led.
2. **A wrong quiz answer.** The sheet says a correct answer "allows the
   turn to continue," but doesn't say what happens after a wrong one.
   Default here: the player's card-play step is skipped for that turn.
   Toggle this off in Setup → house-rule settings if you'd rather they
   still get to play cards.
3. **Who answers "Ask Your Own Question."** The sheet says the creator
   doesn't answer their own question, but not who does. This build asks
   the next player in turn order.
4. **Starting hand size.** Not specified in the sheet. Defaults to 7,
   adjustable in Setup.
5. **After a voluntary draw, can you still play?** The sheet says drawing
   "continues the normal turn process." This build lets you play the
   drawn card immediately if it's legal, or end your turn.
6. **End-of-round scoring for remaining cards.** Explicitly left
   unlocked in the sheet ("deliberately not invented"). This build does
   **not** score remaining cards — the round summary just shows who went
   out first and everyone's quiz score. Nothing has been invented here on
   purpose; let us know the house rule once it's agreed and it's a small
   change to add.
7. **4v4 teams vs. the 7-seat table.** The sheet says the quiz supports
   1v1/2v2/3v3/4v4, but also fixes the table at seven seats. 4v4 needs
   eight. Rather than guess how to squeeze that in, 4v4 is disabled in
   Setup for now — 2v2 and 3v3 both work today.
8. **Multiple 7s in one run.** Not mentioned as stackable in the sheet
   (unlike 8s). For consistency, this build toggles direction once per 7
   in an unbroken same-rank group at the end of a run (two 7s cancel out,
   matching how a double-reversal would behave anyway).

## Running it locally

```bash
npm install
npm run dev
```

Then open the local URL Vite prints (usually `http://localhost:5173`).

## Building for production

```bash
npm run build
npm run preview   # optional local check of the production build
```

The production files are written to `dist/`.

## Publishing to GitHub Pages

This project is pre-configured with `base: '/FCcardgame/'` in
`vite.config.js`, matching a GitHub repo named **FCcardgame**.

1. Create a GitHub repo called `FCcardgame` (or rename the
   `base` in `vite.config.js` to match whatever you call it) and push
   this project to it.
2. Install the deploy helper (already in `devDependencies`):
   ```bash
   npm install
   npm run deploy
   ```
   This builds the app and pushes `dist/` to a `gh-pages` branch.
3. In the repo's **Settings → Pages**, set the source to the `gh-pages`
   branch (root).
4. Your test build will be live at
   `https://<your-username>.github.io/FCcardgame/`.

If you'd rather not use the `gh-pages` branch flow, GitHub Actions'
default "Deploy static content" workflow also works — just point it at
`npm run build` and the `dist/` folder.

## Project structure

```
├── index.html              Vite entry HTML
├── vite.config.js          GitHub Pages base path lives here
├── public/                 logo, table art, favicon (served as-is)
└── src/
    ├── main.jsx             React bootstrap
    ├── App.jsx               all screens + game state machine
    ├── styles.css             table/card/UI styling
    └── game/
        ├── engine.js          deck, connection rule, power effects
        └── questions.js       local quiz question bank
```

## Customising the quiz questions

`src/game/questions.js` is plain data — add, remove or edit questions
(each needs exactly 1 correct + 2 incorrect answers) and they'll show up
in the topic mix automatically.

## Known limitations of this test build

- Single shared device only ("pass and play") — there's a "pass to
  \<name\>" screen between turns so hands stay private, but there's no
  network multiplayer.
- The quiz question bank is a small starter set — swap in your family's
  real question list whenever you're ready.

## New start flow

The opening screen is now the Family Circle home screen. **PLAY A GAME** opens the game setup, where the host selects 2–7 players and names. The opening dealer is chosen randomly when the game starts. The dealer begins the turn order, and play moves to the left (counter-clockwise). Starting another round advances the dealer one active seat to the left rather than choosing a new random dealer.

The home screen also includes **RULES** and **POWER CARDS** reference screens for the rules/effects represented by this testing build.
