const AUDIO = {
  shuffle: 'Shuffle.wav',
  cardPlace: 'card-place.mp3',
  cardDraw: 'card-draw.mp3',
  reverse: 'reverse.wav',
  skip: 'skip.wav',
  pickup: 'pickup.wav',
  cancel: 'cancel.wav',
  ace: 'ace.wav',
  lastCard: 'last-card.mp3',
  // Challenge sound will be available as soon as challenge.wav is uploaded.
  challenge: 'challenge.wav',
  winner: 'winner.wav',
}

const cache = new Map()

function audioUrl(fileName) {
  return `${import.meta.env.BASE_URL}audio/${fileName}`
}

export function playSfx(name, volume = 0.7) {
  if (typeof window === 'undefined' || !AUDIO[name]) return

  try {
    const src = audioUrl(AUDIO[name])
    let audio = cache.get(src)

    // Clone cached audio so short effects can overlap cleanly without
    // interrupting an already-playing instance.
    if (audio) {
      audio = audio.cloneNode(true)
    } else {
      audio = new Audio(src)
      audio.preload = 'auto'
      cache.set(src, audio)
    }

    audio.volume = volume
    audio.currentTime = 0
    const promise = audio.play()
    if (promise?.catch) {
      promise.catch(() => {})
    }
  } catch {
    // SFX are enhancement only; gameplay remains fully usable if playback
    // is blocked by browser autoplay policy or an unavailable asset.
  }
}
