const ITUNES_SEARCH_ENDPOINT = '/api/itunes/search'
const PLUGIN_ENDPOINT = '/api/apple-music/create-playlist'

/**
 * Search iTunes API for a track
 */
async function searchiTunes(trackName, artistName) {
  const query = encodeURIComponent(`${trackName} ${artistName}`)
  const res = await fetch(`${ITUNES_SEARCH_ENDPOINT}?term=${query}&media=music&entity=song&limit=1&country=FR`)
  if (!res.ok) return null
  const data = await res.json()
  if (data.results?.length > 0) {
    const t = data.results[0]
    return {
      trackName: t.trackName,
      artistName: t.artistName,
      trackViewUrl: t.trackViewUrl,
    }
  }
  return null
}

/**
 * Export playlist to Apple Music:
 * 1. Resolve each track via iTunes Search API
 * 2. Send resolved tracks to the local server plugin
 * 3. The plugin uses AppleScript to create the playlist in Music.app
 */
export async function exportToAppleMusic(tracks, playlistName, onProgress) {
  if (!tracks?.length) throw new Error('Aucun morceau à exporter')

  // Step 1: Resolve tracks via iTunes API
  const resolved = []
  const batchSize = 5

  for (let i = 0; i < tracks.length; i += batchSize) {
    const batch = tracks.slice(i, i + batchSize)
    const promises = batch.map(async (t) => {
      const artist = t.artists?.[0]?.name || ''
      const result = await searchiTunes(t.name, artist).catch(() => null)
      if (result) {
        return {
          name: result.trackName,
          artist: result.artistName,
          url: result.trackViewUrl,
        }
      }
      return null
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
