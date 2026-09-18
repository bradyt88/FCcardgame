// Family Circle — seven-seat table model
// The physical game table always has seven equal seat positions.
// Seat 0 is the visual 6 o'clock position in a player's local view.
// In the game model, seats are fixed for the duration of a game.
// A player's screen may rotate/reframe these fixed seats so that the local
// player is rendered at visual seat 0.

export const TABLE_SEAT_COUNT = 7
export const LOCAL_VIEW_SEAT = 0
export const DEFAULT_DIRECTION = -1 // left / counter-clockwise

// CSS uses 0deg at the right and positive degrees downward.
// Starting at 90deg puts visual seat 0 at 6 o'clock.
// Decreasing the angle moves counter-clockwise around the table.
export const TABLE_SEAT_ANGLES = Array.from(
  { length: TABLE_SEAT_COUNT },
  (_, seat) => 90 - (seat * 360) / TABLE_SEAT_COUNT,
)

export function nextOccupiedSeat(players, fromSeat, direction = DEFAULT_DIRECTION) {
  if (!players?.length) return null

  const occupied = new Set(players.filter((p) => !p.out).map((p) => p.seatIndex))
  if (!occupied.size) return null

  let seat = fromSeat
  for (let step = 0; step < TABLE_SEAT_COUNT; step += 1) {
    seat = (seat + direction + TABLE_SEAT_COUNT) % TABLE_SEAT_COUNT
    if (occupied.has(seat)) return seat
  }

  return fromSeat
}

export function playerAtSeat(players, seatIndex) {
  return players.find((p) => p.seatIndex === seatIndex && !p.out) || null
}

// Maps an absolute game seat into the local player's seven-position view.
// Whatever the player's actual game seat is, they appear at local view seat 0
// (6 o'clock) on their own device.
export function relativeViewSeat(localSeat, absoluteSeat) {
  return (absoluteSeat - localSeat + TABLE_SEAT_COUNT) % TABLE_SEAT_COUNT
}

export function assignDemoSeats(players) {
  // Demo-only default: assign a seat only when one has not already been fixed.
  // Online lobby seat selection can supply explicit seatIndex values later.
  return players.map((player, index) => ({
    ...player,
    seatIndex: Number.isInteger(player.seatIndex) ? player.seatIndex : index,
  }))
}
