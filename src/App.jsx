import { useReducer, useState } from 'react'
import {
  SUIT_SYMBOL,
  makeDeck,
  shuffle,
  dealHands,
  canLeadWith,
  validateRunChain,
  canFinishOn,
  canCounterPickup,
  isRedJack,
  isBlackJack,
  isPowerCard,
  computePlayEffect,
} from './game/engine.js'
import {
  DEFAULT_DIRECTION,
  assignDemoSeats,
  nextOccupiedSeat,
  playerAtSeat,
} from './game/table.js'
// ---------- deck / draw pile helpers ----------

function drawCards(deck, discard, count) {
  let d = deck.slice()
  let disc = discard.slice()
  const drawn = []
  for (let i = 0; i < count; i++) {
    if (d.length === 0) {
      if (disc.length <= 1) break
      const top = disc[disc.length - 1]
      const rest = disc.slice(0, -1).reverse() // turned over, NOT shuffled — rule 6
      d = rest
      disc = [top]
    }
    drawn.push(d.shift())
  }
  return { drawn, deck: d, discard: disc }
}

// ---------- initial / reducer ----------

const initialState = { phase: 'home' }

function startNewGame(setup, dealerSeatOverride = null) {
  const { players: rawPlayers, handSize } = setup
  const deck = shuffle(makeDeck())
  const { hands, remainingDeck } = dealHands(deck, rawPlayers.length, handSize)
  const players = assignDemoSeats(rawPlayers).map((p, i) => ({
    ...p,
    hand: hands[i],
    out: false,
  }))
  // The opening play card must be a normal card, not a power card.
  // Keep turning cards until a non-power card is exposed, then retain the
  // displaced cards in the draw pile without shuffling them.
  let deckLeft = remainingDeck.slice()
  let firstCard = deckLeft.shift()
  const bottomBuffer = []
  while (firstCard && isPowerCard(firstCard) && deckLeft.length > 0) {
    bottomBuffer.push(firstCard)
    firstCard = deckLeft.shift()
  }
  deckLeft = [...deckLeft, ...bottomBuffer]

  const dealerSeat = Number.isInteger(dealerSeatOverride)
    ? dealerSeatOverride
    : players[Math.floor(Math.random() * players.length)].seatIndex

  return {
    phase: 'demo-pass-device',
    mode: setup.mode || 'local-demo',
    settings: { handSize },
    players,
    dealerSeat,
    currentSeat: dealerSeat,
    localPlayerId: setup.localPlayerId || players[0]?.id || null,
    direction: DEFAULT_DIRECTION,
    deck: deckLeft,
    discard: [firstCard],
    requiredSuit: null,
    pendingPickup: 0,
    pendingSkip: 0,
    selectedCardIds: [],
    hasDrawnThisTurn: false,
    feedback: null,
    log: [`New round dealt. ${playerAtSeat(players, dealerSeat).name} is the random dealer and starts. ${firstCard.rank} of ${firstCard.suit} starts the pile.`],
    winner: null,
  }
}

function pushLog(state, line) {
  const log = [line, ...state.log].slice(0, 6)
  return { ...state, log }
}

function reducer(state, action) {
  switch (action.type) {
    case 'START_GAME':
      return startNewGame(action.payload)

    case 'GO_HOME':
      return { phase: 'home' }

    case 'GO_TO_SETUP':
      return { phase: 'setup' }

    case 'SHOW_RULES':
      return { phase: 'rules' }

    case 'SHOW_POWER_CARDS':
      return { phase: 'power-cards' }

    case 'READY_FOR_CARDS': {
      const currentPlayer = playerAtSeat(state.players, state.currentSeat)
      const demoView = state.mode === 'local-demo' && currentPlayer
        ? { localPlayerId: currentPlayer.id }
        : {}
      const base = {
        ...state,
        ...demoView,
        feedback: null,
        selectedCardIds: [],
        hasDrawnThisTurn: false,
      }
      const phase = state.pendingPickup > 0
        ? 'pickup-response'
        : state.pendingSkip > 0
          ? 'skip-response'
          : 'card-play'
      return { ...base, phase }
    }

    case 'TOGGLE_CARD': {
      const id = action.payload
      const sel = state.selectedCardIds
      if (sel.length && sel[sel.length - 1] === id) {
        return { ...state, selectedCardIds: sel.slice(0, -1) }
      }
      if (sel.includes(id)) return state
      return { ...state, selectedCardIds: [...sel, id] }
    }

    case 'CLEAR_SELECTION':
      return { ...state, selectedCardIds: [] }

    case 'ACCEPT_SKIP': {
      const player = playerAtSeat(state.players, state.currentSeat)
      const nextState = pushLog(
        { ...state, pendingSkip: 0 },
        `${player.name} accepted the skip.`
      )
      return advanceToNextTurn(nextState)
    }

    case 'PLAY_PICKUP_RESPONSE': {
      const player = playerAtSeat(state.players, state.currentSeat)
      const cards = state.selectedCardIds.map((id) => player.hand.find((c) => c.id === id))
      if (cards.length === 0) return state

      const allRedJackSingle = cards.length === 1 && isRedJack(cards[0])
      const allCounters = cards.every((c) => canCounterPickup(c))
      if (!allRedJackSingle && !allCounters) {
        return { ...state, feedback: { error: 'Pick only 2s / Black Jacks to stack, or a single Red Jack to cancel.' } }
      }

      const newHand = player.hand.filter((c) => !state.selectedCardIds.includes(c.id))
      if (newHand.length === 0 && !canFinishOn(cards[cards.length - 1])) {
        return { ...state, feedback: { error: "You can't finish your hand on a power card." } }
      }

      const players = state.players.map((p) => (
        p.seatIndex === state.currentSeat ? { ...player, hand: newHand } : p
      ))
      const discard = [...state.discard, ...cards]

      let pendingPickup = state.pendingPickup
      let logLine
      if (allRedJackSingle) {
        pendingPickup = 0
        logLine = `${player.name} played a Red Jack — pickup cancelled.`
      } else {
        const add = cards.reduce((sum, c) => sum + (isBlackJack(c) ? 5 : 2), 0)
        pendingPickup += add
        logLine = `${player.name} stacked the pickup to ${pendingPickup}.`
      }

      if (newHand.length === 0) {
        return pushLog(
          { ...state, players, discard, pendingPickup: 0, phase: 'round-over', winner: player.id },
          `${player.name} goes out!`
        )
      }

      const nextState = pushLog({ ...state, players, discard, pendingPickup, requiredSuit: null }, logLine)
      return endTurn(nextState, { reverseCount: 0 })
    }

    case 'DRAW_PICKUP': {
      const player = playerAtSeat(state.players, state.currentSeat)
      const { drawn, deck, discard } = drawCards(state.deck, state.discard, state.pendingPickup)
      const players = state.players.map((p) => (
        p.seatIndex === state.currentSeat ? { ...player, hand: [...player.hand, ...drawn] } : p
      ))
      const nextState = pushLog(
        { ...state, players, deck, discard, pendingPickup: 0 },
        `${player.name} picked up ${drawn.length} card(s).`
      )
      return endTurn(nextState, { reverseCount: 0 })
    }

    case 'DRAW_ONE': {
      if (state.hasDrawnThisTurn) return state
      const player = playerAtSeat(state.players, state.currentSeat)
      const { drawn, deck, discard } = drawCards(state.deck, state.discard, 1)
      const players = state.players.map((p) => (
        p.seatIndex === state.currentSeat ? { ...player, hand: [...player.hand, ...drawn] } : p
      ))
      return pushLog(
        { ...state, players, deck, discard, hasDrawnThisTurn: true },
        `${player.name} drew a card.`
      )
    }


    case 'PLAY_SELECTED': {
      const player = playerAtSeat(state.players, state.currentSeat)
      const cards = state.selectedCardIds.map((id) => player.hand.find((c) => c.id === id))
      if (cards.length === 0) return state

      const topCard = state.discard[state.discard.length - 1]
      if (state.pendingSkip > 0 && cards.some((card) => card.rank !== '8')) {
        return { ...state, feedback: { error: 'A skip is active. Play an 8 to continue the stack, or accept the skip.' } }
      }
      if (!canLeadWith(cards[0], topCard, state.requiredSuit)) {
        return { ...state, feedback: { error: `That doesn't connect to the ${topCard.rank} of ${topCard.suit}${state.requiredSuit ? ` (must be ${state.requiredSuit})` : ''}.` } }
      }
      if (!validateRunChain(cards)) {
        return { ...state, feedback: { error: 'Those cards don\u2019t form a valid connected run.' } }
      }

      const newHand = player.hand.filter((c) => !state.selectedCardIds.includes(c.id))
      const finishing = newHand.length === 0
      if (finishing && !canFinishOn(cards[cards.length - 1])) {
        return { ...state, feedback: { error: 'You can\u2019t finish your hand on that power card.' } }
      }

      const players = state.players.map((p) => (
        p.seatIndex === state.currentSeat ? { ...player, hand: newHand } : p
      ))
      const discard = [...state.discard, ...cards]
      const effect = computePlayEffect(cards)

      let nextState = pushLog(
        { ...state, players, discard, requiredSuit: effect.power === 'ace' ? state.requiredSuit : null },
        `${player.name} played ${cards.map((c) => `${c.rank}${SUIT_SYMBOL[c.suit]}`).join(' \u2192 ')}.`
      )

      if (finishing) {
        return { ...nextState, phase: 'round-over', winner: player.id }
      }

      if (effect.cancelPickup) nextState = { ...nextState, pendingPickup: 0 }
      else if (effect.pickupAdd) nextState = { ...nextState, pendingPickup: nextState.pendingPickup + effect.pickupAdd }

      if (effect.needsSuitChoice) {
        return { ...nextState, phase: 'suit-pick', pendingEffect: effect }
      }

      return endTurn(nextState, effect)
    }

    case 'CHOOSE_SUIT': {
      const withSuit = { ...state, requiredSuit: action.payload, pendingEffect: undefined }
      return endTurn(withSuit, state.pendingEffect || {})
    }

    case 'PLAY_AGAIN': {
      const setup = {
        players: state.players.map((p) => ({
          id: p.id,
          name: p.name,
          seatIndex: p.seatIndex,
        })),
        handSize: state.settings.handSize,
        mode: state.mode,
        localPlayerId: state.localPlayerId,
      }
      const nextDealer = nextOccupiedSeat(state.players, state.dealerSeat, DEFAULT_DIRECTION)
      return startNewGame(setup, nextDealer)
    }

    default:
      return state
  }
}

function advanceToNextTurn(state, effect = {}) {
  let direction = state.direction
  if (effect.reverseCount && effect.reverseCount % 2 === 1) direction = direction * -1

  const pendingSkip = (state.pendingSkip || 0) + (effect.skipAdd || 0)
  const nextSeat = nextOccupiedSeat(state.players, state.currentSeat, direction)

  return {
    ...state,
    direction,
    currentSeat: nextSeat,
    pendingSkip,
    phase: state.mode === 'online'
      ? (pendingSkip > 0 ? 'skip-response' : 'card-play')
      : 'demo-pass-device',
    selectedCardIds: [],
    hasDrawnThisTurn: false,
    feedback: null,
  }
}

function endTurn(state, effect = {}) {
  return advanceToNextTurn({ ...state, pendingSkip: state.pendingSkip || 0 }, effect)
}

// ---------- UI ----------

export default function App() {
  const [state, dispatch] = useReducer(reducer, initialState)

  if (state.phase === 'home') {
    return (
      <HomeScreen
        onPlay={() => dispatch({ type: 'GO_TO_SETUP' })}
        onRules={() => dispatch({ type: 'SHOW_RULES' })}
        onPowerCards={() => dispatch({ type: 'SHOW_POWER_CARDS' })}
      />
    )
  }

  if (state.phase === 'setup') {
    return <SetupScreen onBack={() => dispatch({ type: 'GO_HOME' })} onStart={(payload) => dispatch({ type: 'START_GAME', payload })} />
  }

  if (state.phase === 'rules') {
    return <RulesScreen onBack={() => dispatch({ type: 'GO_HOME' })} />
  }

  if (state.phase === 'power-cards') {
    return <PowerCardsScreen onBack={() => dispatch({ type: 'GO_HOME' })} />
  }

  return <GameBody state={state} dispatch={dispatch} />
}

function HomeScreen({ onPlay, onRules, onPowerCards }) {
  return (
    <main className="home-screen">
      <div className="home-orbit orbit-one" aria-hidden="true" />
      <div className="home-orbit orbit-two" aria-hidden="true" />
      <div className="home-glow glow-pink" aria-hidden="true" />
      <div className="home-glow glow-blue" aria-hidden="true" />

      <section className="home-card" aria-label="Family Circle card game">
        <div className="home-hero">
          <img
            className="home-logo"
            src={`${import.meta.env.BASE_URL}logo.webp`}
            alt="Family Circle — Together Always"
          />
          <div className="home-kicker">THE CARD GAME</div>
          <p className="home-copy">A private family card game for 2–7 players.</p>
        </div>

        <div className="home-actions">
          <button className="btn primary big home-play" onClick={onPlay}>
            PLAY A GAME
          </button>

          <div className="home-secondary">
            <button className="btn secondary" onClick={onRules}>RULES</button>
            <button className="btn secondary" onClick={onPowerCards}>POWER CARDS</button>
          </div>
        </div>
      </section>
    </main>
  )
}

function RulesScreen({ onBack }) {
  return (
    <div className="info-screen">
      <div className="info-card">
        <img className="info-logo" src={`${import.meta.env.BASE_URL}logo.webp`} alt="Family Circle" />
        <h1>Family Circle Rules</h1>
        <p className="info-intro">Card-game rules reference.</p>
        <div className="info-grid">
          <div><strong>Players</strong><span>2–7 players</span></div>
          <div><strong>Cards</strong><span>Standard 52-card deck</span></div>
          <div><strong>Starting hand</strong><span>7 cards by default</span></div>
          <div><strong>Turn</strong><span>Dealer starts; play then moves to the left</span></div>
          <div><strong>Runs</strong><span>Cards connect by same suit + adjacent rank, or same rank in different suits.</span></div>
          <div><strong>Draw pile</strong><span>If exhausted, the discard pile is turned over without shuffling, keeping the top card active.</span></div>
        </div>
        <button className="btn secondary back-btn" onClick={onBack}>BACK</button>
      </div>
    </div>
  )
}

function PowerCardsScreen({ onBack }) {
  const cards = [
    ['Ace', 'Wild — playable any time and chooses the next suit.'],
    ['2', '+2 pickup and stacks with other 2s and Black Jacks.'],
    ['7', 'Reverses direction.'],
    ['8', 'Skips the next player and can be stacked/cancelled by another 8.'],
    ['Red Jack', 'Cancels an active pickup.'],
    ['Black Jack', '+5 pickup and stacks with 2s and other Black Jacks.'],
  ]
  return (
    <div className="info-screen">
      <div className="info-card">
        <img className="info-logo" src={`${import.meta.env.BASE_URL}logo.webp`} alt="Family Circle" />
        <h1>Power Cards</h1>
        <p className="info-intro">Reference for the power effects already implemented in the supplied engine.</p>
        <div className="power-list">
          {cards.map(([name, text]) => (
            <div className="power-row" key={name}>
              <span className="power-name">{name}</span>
              <span className="power-text">{text}</span>
            </div>
          ))}
        </div>
        <button className="btn secondary back-btn" onClick={onBack}>BACK</button>
      </div>
    </div>
  )
}

function GameBody({ state }) {
  return <TablePreview state={state} />
}

function TablePreview({ state }) {
  const localPlayer = state.players.find((p) => p.id === state.localPlayerId) || state.players[0]
  const topCard = state.discard?.[state.discard.length - 1]
  const activeIds = new Set(state.players.filter((p) => !p.out).map((p) => p.id))

  // Seven seats total, always. The local player is visual seat 0 at 6 o'clock.
  // The remaining six seats are evenly spaced around the circle; with seven
  // positions there is intentionally no diametrically opposite seat.
  const seats = Array.from({ length: 7 }, (_, viewSeat) => {
    const player = state.players.find((p) => (
      p.seatIndex === (
        (localPlayer?.seatIndex ?? 0) - viewSeat + 7
      ) % 7
    ))
    return { viewSeat, player }
  })

  return (
    <main className="table-preview-screen">
      <header className="table-preview-header">
        <div className="table-brand">
          <img src={`${import.meta.env.BASE_URL}logo.webp`} alt="Family Circle" />
          <div>
            <div className="table-brand-name">FAMILY CIRCLE</div>
            <div className="table-brand-sub">THE CARD GAME</div>
          </div>
        </div>
        <div className="table-view-badge">ONLINE VIEW · 7 SEAT TABLE</div>
      </header>

      <section className="table-layout">
        <div className="table-wrap">
          <div className="table-ring" aria-hidden="true" />
          <div className="table-felt">
            <div className="table-inner-ring" aria-hidden="true" />
            <img
              className="table-center-logo"
              src={`${import.meta.env.BASE_URL}logo.webp`}
              alt=""
              aria-hidden="true"
            />

            <div className="table-piles">
              <div className="table-pile">
                <div className="pile-card pile-card-back">
                  <span>FC</span>
                </div>
                <span className="pile-label">DRAW PILE</span>
                <strong>{state.deck?.length ?? 0}</strong>
              </div>

              <div className="table-pile">
                <div className="pile-card pile-card-play">
                  <span>{topCard?.rank ?? 'A'}</span>
                  <small>{topCard ? SUIT_SYMBOL[topCard.suit] : '♠'}</small>
                </div>
                <span className="pile-label">PLAY PILE</span>
              </div>
            </div>

            <div className="seat-layer">
              {seats.map(({ viewSeat, player }) => {
                const isYou = viewSeat === 0
                const occupied = Boolean(player && activeIds.has(player.id))
                return (
                  <div
                    className={`table-seat table-seat-${viewSeat} ${isYou ? 'you' : ''} ${occupied ? 'occupied' : 'empty'}`}
                    key={viewSeat}
                  >
                    <div className="seat-disc">
                      <span>{isYou ? 'YOU' : occupied ? player.name.slice(0, 8) : 'OPEN'}</span>
                    </div>
                    <div className="seat-caption">
                      {isYou ? 'YOU · 6 O\'CLOCK' : occupied ? `${player.name} · ${player.hand.length} CARDS` : 'OPEN SEAT'}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>

        <div className="table-hand">
          <div className="hand-heading">
            <span>YOUR HAND</span>
            <strong>{localPlayer?.hand.length ?? 0} CARDS</strong>
          </div>
          <div className="hand-placeholder">
            {Array.from({ length: 7 }, (_, i) => (
              <div className="hand-card-back" key={i}>
                <span>{i + 1}</span>
              </div>
            ))}
          </div>
          <div className="table-demo-note">
            <span>TABLE PROTOTYPE</span>
            <p>Seven total seats. YOU is always at 6 o'clock on your device. There is deliberately no seat directly opposite.</p>
          </div>
        </div>
      </section>
    </main>
  )
}

// ---------- setup ----------

function SetupScreen({ onBack, onStart }) {
  const [count, setCount] = useState(4)
  const [names, setNames] = useState(['Player 1', 'Player 2', 'Player 3', 'Player 4', 'Player 5', 'Player 6', 'Player 7'])
  const [handSize, setHandSize] = useState(7)

  function handleStart() {
    const players = Array.from({ length: count }, (_, i) => ({
      id: `p${i}`,
      name: names[i] || `Player ${i + 1}`,
    }))
    onStart({ players, handSize, mode: 'local-demo', localPlayerId: players[0]?.id })
  }

  return (
    <div className="setup-screen">
      <div className="setup-card">
        <img className="setup-logo" src={`${import.meta.env.BASE_URL}logo.webp`} alt="Family Circle" />
        <h1>Family Circle</h1>
        <p className="setup-tag">Together Always — set up tonight’s game</p>

        <button className="text-link back-link" onClick={onBack}>← Back</button>
        <div className="setup-dealer-note">Dealer: <strong>Random</strong> — the game chooses the opening dealer automatically.</div>

        <label className="field-label">Number of players ({count})</label>
        <input type="range" min="2" max="7" value={count} onChange={(e) => setCount(Number(e.target.value))} />

        <div className="name-grid">
          {Array.from({ length: count }).map((_, i) => (
            <input
              key={i}
              className="text-input"
              value={names[i]}
              onChange={(e) => {
                const next = names.slice()
                next[i] = e.target.value
                setNames(next)
              }}
              placeholder={`Player ${i + 1} name`}
            />
          ))}
        </div>

        <details className="settings-details" open>
          <summary>Game settings</summary>
          <label className="field-label">Starting hand size ({handSize})</label>
          <input type="range" min="7" max="7" value={handSize} onChange={(e) => setHandSize(Number(e.target.value))} disabled />
          <p className="hint">Each player is dealt 7 cards. The opening dealer is selected randomly, and play starts with the dealer before moving left.</p>
        </details>

        <button className="btn primary big" onClick={handleStart}>START GAME</button>
      </div>
    </div>
  )
}
