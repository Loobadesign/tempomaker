export const TEMPO_RANGES = {
  slow: { label: 'Lent', min: 50, max: 90, emoji: '🐢', description: '50–90 BPM' },
  moderate: { label: 'Modéré', min: 90, max: 120, emoji: '🚶', description: '90–120 BPM' },
  fast: { label: 'Rapide', min: 120, max: 150, emoji: '🏃', description: '120–150 BPM' },
  ultrafast: { label: 'Ultra Rapide', min: 150, max: 250, emoji: '⚡', description: '150+ BPM' },
}

const BASE = '/api/deezer'

async function deezerFetch(endpoint) {
  const res = await fetch(`${BASE}${endpoint}`)
  if (!res.ok) throw new Error(`Deezer API error: ${res.status}`)
  return res.json()
}

async function getTrackBpm(trackId) {
  const data = await deezerFetch(`/track/${trackId}`)
  return data.bpm || 0
}

/**
 * Search Deezer for tracks, fetch their BPM, and filter by tempo range.
 */
export async function generatePlaylistByTempo(tempoKey) {
  const range = TEMPO_RANGES[tempoKey]
  if (!range) throw new Error('Invalid tempo key')

  // Search queries tailored to each tempo range
  const queries = {
    slow: ['chill', 'slow ballad', 'acoustic relaxing', 'lofi chill', 'ambient', 'soul classic'],
    moderate: ['pop hits', 'indie rock', 'rnb', 'funk groove', 'reggae', 'hip hop chill'],
    fast: ['workout', 'dance pop', 'edm', 'rock energy', 'running playlist', 'house music'],
    ultrafast: ['drum and bass', 'hardstyle', 'speedcore', 'punk rock fast', 'techno hard', 'metal'],
  }

  const searchTerms = queries[tempoKey]
  const allTracks = []
  const seen = new Set()

  // Search multiple terms in parallel
  const searchPromises = searchTerms.map((q) =>
    deezerFetch(`/search?q=${encodeURIComponent(q)}&limit=25`).catch(() => ({ data: [] }))
  )
  const searchResults = await Promise.all(searchPromises)

  // Collect all unique tracks
  const candidates = []
  for (const result of searchResults) {
    if (!result.data) continue
    for (const track of result.data) {
      if (!track.id || seen.has(track.id)) continue
      seen.add(track.id)
      candidates.push(track)
    }
  }

  // Fetch BPM for each track (batch in groups of 10 for speed)
  const batchSize = 10
  for (let i = 0; i < candidates.length && allTracks.length < 40; i += batchSize) {
    const batch = candidates.slice(i, i + batchSize)
    const bpmPromises = batch.map((t) => getTrackBpm(t.id).catch(() => 0))
    const bpms = await Promise.all(bpmPromises)

    for (let j = 0; j < batch.length; j++) {
      const bpm = bpms[j]
      if (bpm >= range.min && bpm <= range.max) {
        allTracks.push({
          id: batch[j].id,
          name: batch[j].title,
          artists: [{ name: batch[j].artist?.name || 'Unknown' }],
          album: {
            name: batch[j].album?.title || '',
            images: [
              { url: batch[j].album?.cover_big || '' },
              { url: batch[j].album?.cover_medium || '' },
              { url: batch[j].album?.cover_small || '' },
            ],
          },
          preview_url: batch[j].preview || null,
          tempo: bpm,
          deezer_link: batch[j].link,
        })
      }
      if (allTracks.length >= 40) break
    }
  }

  // Shuffle for variety
  for (let i = allTracks.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[allTracks[i], allTracks[j]] = [allTracks[j], allTracks[i]]
  }

  return allTracks
}
