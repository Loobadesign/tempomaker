/**
 * Search iTunes API for a track and return the Apple Music URL + metadata
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
      appleMusicId: track.trackId,
      artworkUrl: track.artworkUrl100,
    }
  }
  return null
}

/**
 * Resolve all tracks to Apple Music URLs.
 * Returns an array of { name, artist, appleMusicUrl } objects.
 * Calls onProgress(current, total) for each resolved track.
 */
export async function resolveAppleMusicLinks(tracks, onProgress) {
  const results = []
  const batchSize = 5

  for (let i = 0; i < tracks.length; i += batchSize) {
    const batch = tracks.slice(i, i + batchSize)
    const promises = batch.map(async (t) => {
      const artist = t.artists[0]?.name || ''
      const result = await searchiTunes(t.name, artist).catch(() => null)
      return {
        name: t.name,
        artist,
        appleMusicUrl: result?.appleMusicUrl || null,
      }
    })

    const batchResults = await Promise.all(promises)
    results.push(...batchResults)

    if (onProgress) {
      onProgress(Math.min(i + batchSize, tracks.length), tracks.length)
    }
  }

  return results.filter((r) => r.appleMusicUrl)
}

/**
 * Open all Apple Music links — opens the first one directly,
 * copies the full list to clipboard for easy adding.
 */
export function openAppleMusicPlaylist(appleMusicTracks) {
  if (appleMusicTracks.length > 0) {
    window.open(appleMusicTracks[0].appleMusicUrl, '_blank')
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

/**
 * Generate Apple Music search URL for a single track
 */
export function getAppleMusicSearchUrl(trackName, artistName) {
  const query = encodeURIComponent(`${trackName} ${artistName}`)
  return `https://music.apple.com/search?term=${query}`
}
