# Family Circle — Card Game

A private, pass-and-play **Family Circle card game** for 2–7 players.

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
- pass-device flow for private hands

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
│       └── engine.js
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
