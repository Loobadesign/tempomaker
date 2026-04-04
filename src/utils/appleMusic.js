/**
 * Search iTunes API for a track and return Apple Music metadata
 */
async function searchiTunes(trackName, artistName) {
  const query = encodeURIComponent(`${trackName} ${artistName}`)
  const res = await fetch(`/api/itunes/search?term=${query}&media=music&entity=song&limit=1`)
  if (!res.ok) return null
  const data = await res.json()
  if (data.results && data.results.length > 0) {
    const track = data.results[0]
    return {
      appleMusicUrl: track.trackViewUrl,
      trackName: track.trackName,
      artistName: track.artistName,
      durationMs: track.trackTimeMillis || 0,
    }
  }
  return null
}

/**
 * Resolve tracks to Apple Music, then generate and download a .m3u playlist file.
 * Opening the .m3u file on macOS automatically opens Apple Music with the playlist.
 * @param {Array} tracks - array of track objects
 * @param {string} playlistName - name for the playlist
 * @param {Function} onProgress - callback(current, total)
 */
export async function exportToAppleMusic(tracks, playlistName, onProgress) {
  const resolved = []
  const batchSize = 5

  for (let i = 0; i < tracks.length; i += batchSize) {
    const batch = tracks.slice(i, i + batchSize)
    const promises = batch.map(async (t) => {
      const artist = t.artists[0]?.name || ''
      const result = await searchiTunes(t.name, artist).catch(() => null)
      if (result) {
        return {
          name: result.trackName || t.name,
          artist: result.artistName || artist,
          url: result.appleMusicUrl,
          duration: Math.round((result.durationMs || 0) / 1000),
        }
      }
      return null
    })

    const batchResults = await Promise.all(promises)
    for (const r of batchResults) {
      if (r) resolved.push(r)
    }

    if (onProgress) {
      onProgress(Math.min(i + batchSize, tracks.length), tracks.length)
    }
  }

  if (resolved.length === 0) {
    throw new Error('Aucun morceau trouvé sur Apple Music')
  }

  // Generate .m3u playlist
  const lines = ['#EXTM3U', `#PLAYLIST:${playlistName}`]
  for (const track of resolved) {
    lines.push(`#EXTINF:${track.duration},${track.artist} - ${track.name}`)
    lines.push(track.url)
  }

  const content = lines.join('\n')
  const blob = new Blob([content], { type: 'audio/x-mpegurl' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${playlistName.replace(/[^a-zA-Z0-9àâäéèêëïîôùûüÿçÀÂÄÉÈÊËÏÎÔÙÛÜŸÇ -]/g, '')}.m3u`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)

  return resolved.length
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
