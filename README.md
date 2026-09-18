# Family Circle — Card Game

An **online-first Family Circle card game** for 2–7 players.

This repository is for the **card game only**. It does not contain the separate Family Circle quiz game.

## Game flow

1. Open the Family Circle start screen.
2. Select **PLAY A GAME**.
3. Choose 2–7 players and enter their names.
4. The opening dealer is selected randomly.
5. The dealer starts the round.
6. Play then moves to the left / counter-clockwise.
7. When another round is dealt, the dealer advances one active seat to the left.
8. Each player is dealt 7 cards.
9. The remaining deck becomes the draw pile and the opening card becomes the play card.
10. The physical table always has 7 equal seat positions; the local player is rendered at the 6 o'clock position on their own device.
11. Seat assignments are fixed for the game; the visual table may rotate/reframe those fixed seats for the current player.
12. Moving left / counter-clockwise follows the fixed seven-seat order.

## Card game implementation

The supplied card engine implements the Family Circle card rules, including:

- 52-card deck
- 7-card hands
- legal card runs
- forward and backward run direction
- same-rank suit changes inside runs
- Ace suit selection
- 2 pickup and stacking
- 7 reverse
- 8 skip/stack behaviour
- Red Jack pickup cancellation
- Black Jack +5 pickup and stacking
- draw-pile recycling without shuffling
- protection against finishing on a power card
- pass-device flow is retained only as a temporary local testing harness; the product UI is being rebuilt for online play

## Table architecture audit

The old table presentation, legacy header, placeholder pile/card visuals, and quiz-era presentation code have been removed from the application layer.

The rules engine remains separate from presentation. The new table model is in `src/game/table.js` and defines:

- 7 permanent, evenly spaced seat positions
- seat 0 as the local 6 o'clock view position
- fixed seat assignments for a game
- left / counter-clockwise seat traversal
- relative seat mapping so each online player can see themselves at the bottom

The UI also has a canonical `suggestedCardIds()` helper in the engine so the table can highlight legal suggestions without duplicating rules.

One rule remains deliberately unaltered: the engine currently treats a 7 as finishable, while an earlier UI reference said it was not. That conflict has been removed from the UI text rather than silently changing the game rule. It should be locked against the authoritative Family Circle rule sheet before final gameplay release.

## Stage 1 — Brand & Home

The Stage 1 home experience uses the supplied Family Circle hero branding and keeps the start flow deliberately focused on **PLAY A GAME**, **RULES**, and **POWER CARDS**. The later table/game UI is being rebuilt separately, stage by stage.

## Start screen

The opening screen contains:

- **PLAY A GAME**
- **RULES**
- **POWER CARDS**

The rules and power-card screens are reference material for this card game only.

## Project structure

```
FCcardgame/
├── index.html
├── vite.config.js
├── public/
│   ├── logo.webp
│   └── favicon.webp
├── src/
│   ├── main.jsx
│   ├── App.jsx
│   ├── styles.css
│   └── game/
│       ├── engine.js
│       └── table.js
└── .github/
    └── workflows/
        └── deploy-pages.yml
```

## Running locally

```bash
npm ci
npm run dev
```

## Production build

```bash
npm run build
npm run preview
```

The Vite base path is configured for the GitHub repository **FCcardgame**.
