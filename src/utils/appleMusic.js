import {
  buildStyleTerms,
  isLikelyRealArtistName,
  normalizeLoose,
  sanitizeTempoRange,
  scoreAppleMusicCandidate,
} from './appleMusicCriteria.js'

const ITUNES_SEARCH_ENDPOINT = '/api/itunes/search'
const PLUGIN_ENDPOINT = '/api/apple-music/create-playlist'

async function fetchiTunesCandidates(query, limit = 10) {
  if (!query) return []
  const encoded = encodeURIComponent(query)
  const res = await fetch(`${ITUNES_SEARCH_ENDPOINT}?term=${encoded}&media=music&entity=song&limit=${limit}&country=FR`)
  if (!res.ok) return []
  const data = await res.json()
  return (data.results || [])
    .map((t) => ({
      trackId: t.trackId,
      trackName: t.trackName,
      artistName: t.artistName,
      trackViewUrl: t.trackViewUrl,
    }))
    .filter((t) => t.trackName && t.artistName)
}

/**
 * Search iTunes API for multiple candidates, deduplicated by normalized name+artist.
 */
async function searchiTunes(trackName, artistName) {
  const [byTrackArtist, byTrackOnly] = await Promise.all([
    fetchiTunesCandidates(`${trackName} ${artistName}`.trim(), 12),
    fetchiTunesCandidates(trackName, 12),
  ])

  const merged = [...byTrackArtist, ...byTrackOnly]
  const out = []
  const seen = new Set()
  for (const candidate of merged) {
    const key = `${normalizeLoose(candidate.trackName)}|${normalizeLoose(candidate.artistName)}`
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push(candidate)
    if (out.length >= 10) break
  }

  return out
}

function buildHints(trackName, artistName, candidates) {
  const hints = []
  const seen = new Set()

  const pushHint = (name, artist) => {
    const rawName = String(name || '').trim()
    const rawArtist = String(artist || '').trim()
    if (!rawName) return
    const key = `${normalizeLoose(rawName)}|${normalizeLoose(rawArtist)}`
    if (!key || seen.has(key)) return
    seen.add(key)
    hints.push({ name: rawName, artist: rawArtist })
  }

  pushHint(trackName, artistName)
  for (const candidate of candidates) {
    pushHint(candidate.trackName, candidate.artistName)
  }

  return hints.slice(0, 12)
}

function pickBestCandidate(originalName, originalArtist, candidates) {
  if (!Array.isArray(candidates) || candidates.length === 0) return null

  const ranked = candidates
    .map((candidate) => ({
      ...candidate,
      _score: scoreAppleMusicCandidate(
        originalName,
        originalArtist,
        candidate.trackName,
        candidate.artistName
      ),
    }))
    .sort((a, b) => b._score - a._score)

  const best = ranked[0]
  if (!best) return null

  const minScore = isLikelyRealArtistName(originalArtist) ? 180 : 120
  if (best._score < minScore) return null

  return best
}

function mergeExportedTrack(baseTrack, exportedTrack, fallbackIndex) {
  const baseArtist = baseTrack?.artists?.[0]?.name || ''
  const mergedTempo = Number(exportedTrack?.targetTempo)
  const hasMergedTempo = Number.isFinite(mergedTempo) && mergedTempo > 0

  return {
    ...(baseTrack || {}),
    id: baseTrack?.id
      ? `${baseTrack.id}-export-${fallbackIndex}`
      : `export-${fallbackIndex}-${normalizeLoose(exportedTrack?.name || 'track')}`,
    name: exportedTrack?.name || baseTrack?.name || 'Unknown',
    artists: [{ name: exportedTrack?.artist || baseArtist || 'Unknown' }],
    tempo: hasMergedTempo ? mergedTempo : baseTrack?.tempo || null,
    approx: Boolean(exportedTrack?.approx),
    exported: true,
  }
}

export function mergeExportedTracks(originalTracks, exportedTracks) {
  if (!Array.isArray(originalTracks) || originalTracks.length === 0) return []
  if (!Array.isArray(exportedTracks) || exportedTracks.length === 0) return originalTracks

  const byOriginalIndex = new Map()
  const fillTracks = []

  for (const exportedTrack of exportedTracks) {
    if (!exportedTrack?.added) continue
    const slot = Number(exportedTrack.index)

    if (!exportedTrack.fill && Number.isInteger(slot) && slot >= 0 && slot < originalTracks.length) {
      byOriginalIndex.set(slot, exportedTrack)
      continue
    }

    fillTracks.push(exportedTrack)
  }

  const merged = originalTracks.map((track, index) => {
    const exportedTrack = byOriginalIndex.get(index)
    if (!exportedTrack) return track
    return mergeExportedTrack(track, exportedTrack, index)
  })

  fillTracks
    .sort((a, b) => Number(a.index) - Number(b.index))
    .forEach((exportedTrack, offset) => {
      merged.push(mergeExportedTrack(null, exportedTrack, originalTracks.length + offset))
    })

  return merged
}

/**
 * Export playlist to Apple Music:
 * 1. Resolve each track via iTunes Search API
 * 2. Send resolved tracks to the local server plugin
 * 3. The plugin uses AppleScript to create the playlist in Music.app
 */
export async function exportToAppleMusic(tracks, playlistName, optionsOrProgress, maybeOnProgress) {
  if (!tracks?.length) throw new Error('Aucun morceau à exporter')

  const options = (optionsOrProgress && typeof optionsOrProgress === 'object')
    ? optionsOrProgress
    : {}
  const onProgress = typeof optionsOrProgress === 'function' ? optionsOrProgress : maybeOnProgress

  // Step 1: Resolve tracks via iTunes API
  const resolved = []
  const batchSize = 5
  const criteria = {
    requestedCount: tracks.length,
    styleTerms: buildStyleTerms(options.selectedGenres, options.genreLabels),
    tempoRange: sanitizeTempoRange(options.tempoRange),
  }

  for (let i = 0; i < tracks.length; i += batchSize) {
    const batch = tracks.slice(i, i + batchSize)
    const promises = batch.map(async (t) => {
      if (!t?.name) return null
      const artist = t.artists?.[0]?.name || ''
      const candidates = await searchiTunes(t.name, artist).catch(() => [])
      const selectedCandidate = pickBestCandidate(t.name, artist, candidates)
      const chosenName = selectedCandidate?.trackName || t.name
      const chosenArtist = selectedCandidate?.artistName || artist

      const sourceTempo = Number(t.tempo)
      const targetTempo = Number.isFinite(sourceTempo) ? sourceTempo : 0
      const hints = buildHints(t.name, artist, candidates)

      return {
        catalogId: selectedCandidate?.trackId ? String(selectedCandidate.trackId) : '',
        name: chosenName,
        artist: chosenArtist,
        url: selectedCandidate?.trackViewUrl,
        targetTempo,
        hints,
      }
    })
    const results = await Promise.all(promises)
    resolved.push(...results.filter(Boolean))
    if (onProgress) onProgress(Math.min(i + batchSize, tracks.length), tracks.length, 'resolve')
  }

  if (resolved.length === 0) throw new Error('Aucun morceau trouvé sur Apple Music')

  // Step 2: Send to local plugin to create playlist via AppleScript
  if (onProgress) onProgress(0, resolved.length, 'create')

  const res = await fetch(PLUGIN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      playlistName,
      tracks: resolved,
      criteria,
    }),
  })

  const data = await res.json()

  if (!res.ok) {
    throw new Error(data.error || 'Erreur lors de la création de la playlist')
  }

  return {
    totalTracks: tracks.length,
    resolvedTracks: resolved.length,
    addedTracks: data.addedTracks || 0,
    approxTracks: data.approxTracks || 0,
    catalogSearch: Boolean(data.catalogSearch),
    catalogSearchReason: data.catalogSearchReason || '',
    exportedTracks: data.exportedTracks || [],
    playlistTracks: mergeExportedTracks(tracks, data.exportedTracks || []),
  }
}

/**
 * Copy playlist to clipboard
 */
export async function copyPlaylistToClipboard(tracks) {
  const text = tracks
    .map((t) => `${t.name} - ${t.artists[0]?.name || 'Unknown'}`)
    .join('\n')
  await navigator.clipboard.writeText(text)
}
