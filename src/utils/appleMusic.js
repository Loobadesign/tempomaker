const APPLE_MUSIC_PLUGIN_ENDPOINT = '/api/apple-music/create-playlist'
const ITUNES_SEARCH_ENDPOINT = '/api/itunes/search'
const M3U_CONTENT_TYPE = 'audio/x-mpegurl'
const MIN_MATCH_SCORE = 55
const MIN_REPLACEMENT_SCORE = 35

function toAppleTrack(track) {
  const artist = track.artist || track.artists?.[0]?.name || 'Unknown'
  const name = track.name || track.trackName || ''
  return {
    name,
    artist,
    previewUrl: track.previewUrl || '',
  }
}

function sanitizeFilename(filename) {
  return filename.replace(/[^a-zA-Z0-9àâäéèêëïîôùûüÿçÀÂÄÉÈÊËÏÎÔÙÛÜŸÇ -]/g, '')
}

function normalize(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function dedupeStrings(values) {
  return [...new Set(values.filter(Boolean))]
}

function sanitizeTrackName(name) {
  return String(name || '')
    .replace(/\(([^)]*(feat|ft|with)[^)]*)\)/ig, '')
    .replace(/\b(feat|ft|with)\.?\b.*/ig, '')
    .replace(/[-–]\s*(live|edit|version|remaster(ed)?)\b.*/ig, '')
    .trim()
}

function tokenScore(a, b) {
  const aTokens = normalize(a).split(' ').filter(Boolean)
  const bTokens = normalize(b).split(' ').filter(Boolean)
  if (aTokens.length === 0 || bTokens.length === 0) return 0

  const bSet = new Set(bTokens)
  let overlap = 0
  for (const token of aTokens) {
    if (bSet.has(token)) overlap += 1
  }
  return overlap / Math.max(aTokens.length, bTokens.length)
}

function downloadFile(content, filename, contentType) {
  const blob = new Blob([content], { type: contentType })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

async function searchITunesByQuery(query, limit = 15) {
  const params = new URLSearchParams({
    term: query,
    media: 'music',
    entity: 'song',
    limit: String(limit),
  })

  const res = await fetch(`${ITUNES_SEARCH_ENDPOINT}?${params}`)
  if (!res.ok) return []
  const data = await res.json()
  if (!Array.isArray(data.results)) return []

  return data.results
    .map((track) => ({
      trackId: track.trackId,
      trackName: track.trackName || '',
      artistName: track.artistName || '',
      primaryGenreName: track.primaryGenreName || '',
      appleMusicUrl: track.trackViewUrl || '',
      previewUrl: track.previewUrl || '',
      durationMs: track.trackTimeMillis || 0,
    }))
    .filter((track) => track.appleMusicUrl)
}

function dedupeCandidates(candidates) {
  const map = new Map()
  for (const candidate of candidates) {
    const key = candidate.trackId
      ? `id:${candidate.trackId}`
      : `${normalize(candidate.trackName)}::${normalize(candidate.artistName)}`
    if (!map.has(key)) map.set(key, candidate)
  }
  return [...map.values()]
}

function scoreCandidate(candidate, target, preferredGenres, usedTrackIds) {
  if (!candidate) return -1
  if (candidate.trackId && usedTrackIds.has(candidate.trackId)) return -1

  const targetName = normalize(target.name)
  const targetArtist = normalize(target.artist)
  const candidateName = normalize(candidate.trackName)
  const candidateArtist = normalize(candidate.artistName)

  let score = 0

  if (targetName && candidateName === targetName) score += 120
  if (targetArtist && candidateArtist === targetArtist) score += 80

  if (targetName && (candidateName.includes(targetName) || targetName.includes(candidateName))) {
    score += 35
  }

  if (targetArtist && (candidateArtist.includes(targetArtist) || targetArtist.includes(candidateArtist))) {
    score += 25
  }

  score += Math.round(tokenScore(target.name, candidate.trackName) * 40)
  score += Math.round(tokenScore(target.artist, candidate.artistName) * 25)

  if (preferredGenres.has(normalize(candidate.primaryGenreName))) {
    score += 20
  }

  return score
}

function inferTempoQueries(playlistName) {
  const value = normalize(playlistName)
  if (value.includes('lent') || value.includes('slow')) {
    return ['chill', 'relax', 'acoustic']
  }
  if (value.includes('modere') || value.includes('moderate')) {
    return ['pop', 'indie', 'groove']
  }
  if (value.includes('ultra')) {
    return ['hardstyle', 'dnb', 'high energy']
  }
  if (value.includes('rapide') || value.includes('fast')) {
    return ['workout', 'running', 'energy']
  }
  return ['pop', 'hits']
}

function buildTrackQueries(track) {
  const name = String(track.name || '').trim()
  const artist = String(track.artists?.[0]?.name || '').trim()
  const cleanName = sanitizeTrackName(name)
  const shortName = cleanName.split(' ').slice(0, 4).join(' ')

  return dedupeStrings([
    `${name} ${artist}`.trim(),
    `${cleanName} ${artist}`.trim(),
    cleanName,
    `${artist} ${shortName}`.trim(),
    shortName,
  ])
}

async function resolveTrackFromITunes(track, preferredGenres, usedTrackIds) {
  const queries = buildTrackQueries(track)
  const allCandidates = []

  for (const query of queries) {
    const candidates = await searchITunesByQuery(query, 15).catch(() => [])
    allCandidates.push(...candidates)
  }

  const deduped = dedupeCandidates(allCandidates)
  const target = {
    name: sanitizeTrackName(track.name),
    artist: track.artists?.[0]?.name || '',
  }

  let best = null
  let bestScore = -1
  for (const candidate of deduped) {
    const score = scoreCandidate(candidate, target, preferredGenres, usedTrackIds)
    if (score > bestScore) {
      bestScore = score
      best = candidate
    }
  }

  if (!best || bestScore < MIN_MATCH_SCORE) return null

  return {
    trackId: best.trackId,
    name: best.trackName || track.name,
    artist: best.artistName || track.artists?.[0]?.name || 'Unknown',
    url: best.appleMusicUrl,
    previewUrl: best.previewUrl || '',
    duration: Math.round((best.durationMs || 0) / 1000),
    primaryGenreName: best.primaryGenreName || '',
    source: 'original',
  }
}

function collectPreferredGenres(resolvedTracks, max = 3) {
  const counter = new Map()
  for (const track of resolvedTracks) {
    const genre = normalize(track.primaryGenreName)
    if (!genre) continue
    counter.set(genre, (counter.get(genre) || 0) + 1)
  }

  return new Set(
    [...counter.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, max)
      .map(([genre]) => genre)
  )
}

function buildReplacementQueries(track, playlistName, preferredGenres, criteriaQueries) {
  const tempoQueries = inferTempoQueries(playlistName)
  const artist = String(track.artists?.[0]?.name || '').trim()
  const cleanName = sanitizeTrackName(track.name)

  const replacementQueries = [
    `${artist} ${tempoQueries[0]}`.trim(),
    `${cleanName} ${tempoQueries[0]}`.trim(),
    `${cleanName}`.trim(),
    `${playlistName} ${tempoQueries[0]}`.trim(),
  ]

  for (const genre of preferredGenres) {
    replacementQueries.push(`${genre} ${tempoQueries[0]}`.trim())
  }

  for (const query of criteriaQueries) {
    replacementQueries.push(`${query} ${tempoQueries[0]}`.trim())
  }

  return dedupeStrings(replacementQueries).slice(0, 8)
}

async function resolveReplacementTrack(track, playlistName, preferredGenres, usedTrackIds, criteriaQueries) {
  const queries = buildReplacementQueries(track, playlistName, preferredGenres, criteriaQueries)
  const allCandidates = []

  for (const query of queries) {
    const candidates = await searchITunesByQuery(query, 20).catch(() => [])
    allCandidates.push(...candidates)
  }

  const deduped = dedupeCandidates(allCandidates)
  const target = {
    name: sanitizeTrackName(track.name),
    artist: track.artists?.[0]?.name || '',
  }

  let best = null
  let bestScore = -1
  for (const candidate of deduped) {
    const score = scoreCandidate(candidate, target, preferredGenres, usedTrackIds)
    if (score > bestScore) {
      bestScore = score
      best = candidate
    }
  }

  if (!best || bestScore < MIN_REPLACEMENT_SCORE) return null

  return {
    trackId: best.trackId,
    name: best.trackName || sanitizeTrackName(track.name),
    artist: best.artistName || track.artists?.[0]?.name || 'Unknown',
    url: best.appleMusicUrl,
    previewUrl: best.previewUrl || '',
    duration: Math.round((best.durationMs || 0) / 1000),
    primaryGenreName: best.primaryGenreName || '',
    source: 'replacement',
  }
}

async function resolveTracksForAppleMusic(tracks, playlistName, onProgress, criteriaQueries) {
  const resolved = []
  const unresolved = []
  const usedTrackIds = new Set()
  let processed = 0

  for (const track of tracks) {
    const preferredGenres = collectPreferredGenres(resolved)
    const result = await resolveTrackFromITunes(track, preferredGenres, usedTrackIds)

    if (result) {
      resolved.push(result)
      if (result.trackId) usedTrackIds.add(result.trackId)
    } else {
      unresolved.push(track)
    }

    processed += 1
    if (onProgress) onProgress(processed, tracks.length)
  }

  let replacedTracks = 0
  for (const track of unresolved) {
    const preferredGenres = collectPreferredGenres(resolved)
    const replacement = await resolveReplacementTrack(
      track,
      playlistName,
      preferredGenres,
      usedTrackIds,
      criteriaQueries
    )

    if (replacement) {
      resolved.push(replacement)
      if (replacement.trackId) usedTrackIds.add(replacement.trackId)
      replacedTracks += 1
    }
  }

  return {
    resolvedTracks: resolved,
    replacedTracks,
    unresolvedTracks: Math.max(tracks.length - resolved.length, 0),
  }
}

function exportResolvedTracksAsM3U(resolvedTracks, playlistName, totalTracks) {
  if (resolvedTracks.length === 0) {
    throw new Error('Aucun morceau trouvé sur Apple Music')
  }

  const lines = ['#EXTM3U', `#PLAYLIST:${playlistName}`]
  for (const track of resolvedTracks) {
    if (!track.url) continue
    lines.push(`#EXTINF:${track.duration || 0},${track.artist} - ${track.name}`)
    lines.push(track.url)
  }

  downloadFile(lines.join('\n'), `${sanitizeFilename(playlistName)}.m3u`, M3U_CONTENT_TYPE)

  const replacedTracks = resolvedTracks.filter((track) => track.source === 'replacement').length

  return {
    mode: 'm3u',
    totalTracks,
    exportedTracks: resolvedTracks.length,
    skippedTracks: Math.max(totalTracks - resolvedTracks.length, 0),
    replacedTracks,
  }
}

async function createResolvedPlaylistWithLocalPlugin(
  playlistName,
  resolvedTracks,
  totalTracks,
  replacedTracks,
  skippedTracks,
  allowPreviewFallback,
  useShortcut,
  shortcutName
) {
  const response = await fetch(APPLE_MUSIC_PLUGIN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      playlistName,
      tracks: resolvedTracks.map(toAppleTrack),
      allowPreviewFallback,
      useShortcut,
      shortcutName,
    }),
  })

  let body = null
  try {
    body = await response.json()
  } catch {
    body = null
  }

  if (!response.ok) {
    const reason = body?.error || `HTTP ${response.status}`
    throw new Error(`Local Apple Music plugin error: ${reason}`)
  }

  const pluginTotalRaw = Number(body?.totalTracks)
  const pluginTotal = Number.isFinite(pluginTotalRaw)
    ? Math.max(0, Math.trunc(pluginTotalRaw))
    : totalTracks
  const pluginExportedRaw = Number(body?.addedTracks)
  const pluginExported = Number.isFinite(pluginExportedRaw)
    ? Math.max(0, Math.min(Math.trunc(pluginExportedRaw), pluginTotal))
    : 0
  const pluginResults = Array.isArray(body?.results) ? body.results : []
  const method = body?.method === 'shortcut' ? 'shortcut' : 'plugin'
  const previewAdded = pluginResults.filter(
    (result) => result?.added && result?.source === 'preview'
  ).length
  const libraryAdded = pluginResults.filter(
    (result) => result?.added && result?.source === 'library'
  ).length
  const shortcutAdded = pluginResults.filter(
    (result) => result?.added && result?.source === 'shortcut'
  ).length

  return {
    mode: method,
    totalTracks: pluginTotal,
    exportedTracks: pluginExported,
    skippedTracks: Math.max(pluginTotal - pluginExported, skippedTracks),
    replacedTracks,
    previewAdded,
    libraryAdded,
    shortcutAdded,
    shortcutName: body?.shortcutName || '',
    pluginResults,
  }
}

/**
 * Resolve tracks against iTunes/Apple Music, then create playlist locally.
 * If local plugin is unavailable, fallback to .m3u export.
 * @param {Array} tracks - array of track objects
 * @param {string} playlistName - name for the playlist
 * @param {Function} onProgress - callback(current, total)
 */
export async function exportToAppleMusic(tracks, playlistName, onProgress, options = {}) {
  if (!Array.isArray(tracks) || tracks.length === 0) {
    throw new Error('Aucun morceau à exporter')
  }

  if (onProgress) onProgress(0, tracks.length)
  const allowPreviewFallback = options.allowPreviewFallback === true
  const allowM3UFallback = options.allowM3UFallback === true
  const useShortcut = options.useShortcut === true
  const shortcutName = String(options.shortcutName || '').trim()

  const criteriaQueries = dedupeStrings(
    String(options.genreLabels || '')
      .split(',')
      .map((label) => label.trim().toLowerCase())
      .filter(Boolean)
  )

  const { resolvedTracks, replacedTracks, unresolvedTracks } = await resolveTracksForAppleMusic(
    tracks,
    playlistName,
    onProgress,
    criteriaQueries
  )

  if (resolvedTracks.length === 0) {
    throw new Error('Aucun morceau trouvé sur Apple Music')
  }

  try {
    const pluginResult = await createResolvedPlaylistWithLocalPlugin(
      playlistName,
      resolvedTracks,
      tracks.length,
      replacedTracks,
      unresolvedTracks,
      allowPreviewFallback,
      useShortcut,
      shortcutName
    )

    // If plugin could not add all resolved tracks, optionally keep a .m3u fallback.
    if (pluginResult.exportedTracks < resolvedTracks.length && allowM3UFallback) {
      const m3uResult = exportResolvedTracksAsM3U(resolvedTracks, playlistName, tracks.length)
      return {
        ...pluginResult,
        mode: 'plugin+m3u',
        fallbackExportedTracks: m3uResult.exportedTracks,
      }
    }

    if (pluginResult.exportedTracks === 0) {
      throw new Error(
        'Aucun morceau n’a pu être ajouté depuis Apple Music. Vérifie que Sync Library est activé et que Shortcuts a l’accès Apple Music (Media & Apple Music), puis relance.'
      )
    }

    return pluginResult
  } catch (error) {
    if (!allowM3UFallback) {
      throw error
    }

    return exportResolvedTracksAsM3U(resolvedTracks, playlistName, tracks.length)
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
