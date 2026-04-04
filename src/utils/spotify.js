export const TEMPO_RANGES = {
  slow: { label: 'Lent', min: 50, max: 90, emoji: '🐢', description: '50–90 BPM' },
  moderate: { label: 'Modéré', min: 90, max: 120, emoji: '🚶', description: '90–120 BPM' },
  fast: { label: 'Rapide', min: 120, max: 150, emoji: '🏃', description: '120–150 BPM' },
  ultrafast: { label: 'Ultra Rapide', min: 150, max: 250, emoji: '⚡', description: '150+ BPM' },
}

const BASE = '/api/deezer'

const MIN_TRACKS = 30

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
 * Generate a playlist filtered by genre(s) + tempo.
 * Guarantees at least MIN_TRACKS results.
 * @param {string} tempoKey - slow | moderate | fast | ultrafast
 * @param {Array} genres - array of genre objects from genres.js
 * @param {Function} onProgress - callback(found, checked)
 */
export async function generatePlaylistByTempo(tempoKey, genres, onProgress) {
  const range = TEMPO_RANGES[tempoKey]
  if (!range) throw new Error('Invalid tempo key')

  // Collect all search queries from selected genres
  const allQueries = genres.flatMap((g) => g.queries)

  // Shuffle queries for variety
  for (let i = allQueries.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[allQueries[i], allQueries[j]] = [allQueries[j], allQueries[i]]
  }

  const seen = new Set()
  const allTracks = []

  // Search in batches of 4 queries, fetch 40 results each for more candidates
  const queryBatchSize = 4
  for (let q = 0; q < allQueries.length && allTracks.length < MIN_TRACKS; q += queryBatchSize) {
    const queryBatch = allQueries.slice(q, q + queryBatchSize)

    const searchPromises = queryBatch.map((query) =>
      deezerFetch(`/search?q=${encodeURIComponent(query)}&limit=40`).catch(() => ({ data: [] }))
    )
    const searchResults = await Promise.all(searchPromises)

    // Collect unique candidates
    const candidates = []
    for (const result of searchResults) {
      if (!result.data) continue
      for (const track of result.data) {
        if (!track.id || seen.has(track.id)) continue
        seen.add(track.id)
        candidates.push(track)
      }
    }

    // Check BPM in batches of 10
    const bpmBatchSize = 10
    for (let i = 0; i < candidates.length && allTracks.length < MIN_TRACKS + 10; i += bpmBatchSize) {
      const batch = candidates.slice(i, i + bpmBatchSize)
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

          if (onProgress) onProgress(allTracks.length)
        }
      }
    }
  }

  // Shuffle final results
  for (let i = allTracks.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[allTracks[i], allTracks[j]] = [allTracks[j], allTracks[i]]
  }

  return allTracks
}
