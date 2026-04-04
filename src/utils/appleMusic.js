/**
 * Build a shortcuts:// URL that triggers the TempoMaker shortcut
 * with the track list as input. The shortcut then creates the playlist
 * in Apple Music automatically.
 */
export function openInAppleMusicViaShortcut(tracks, playlistName) {
  const lines = tracks.map(
    (t) => `${t.name} - ${t.artists[0]?.name || 'Unknown'}`
  )
  const input = JSON.stringify({ name: playlistName, tracks: lines })
  const encoded = encodeURIComponent(input)
  window.location.href = `shortcuts://run-shortcut?name=TempoMaker&input=text&text=${encoded}`
}

/**
 * Copy playlist to clipboard in a format easy to search on Apple Music
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
