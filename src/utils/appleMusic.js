/**
 * Generate an Apple Music search URL for a track
 */
export function getAppleMusicSearchUrl(trackName, artistName) {
  const query = encodeURIComponent(`${trackName} ${artistName}`)
  return `https://music.apple.com/search?term=${query}`
}

/**
 * Generate a list of Apple Music search links for a playlist
 */
export function generateAppleMusicLinks(tracks) {
  return tracks.map((track) => ({
    name: track.name,
    artist: track.artists[0]?.name || 'Unknown',
    url: getAppleMusicSearchUrl(track.name, track.artists[0]?.name || ''),
  }))
}

/**
 * Export playlist as a text file with track names for manual Apple Music import
 */
export function exportPlaylistAsText(tracks, tempoLabel) {
  const lines = [
    `🎵 TempoMaker Playlist — ${tempoLabel}`,
    `Generated on ${new Date().toLocaleDateString('fr-FR')}`,
    `${tracks.length} tracks`,
    '',
    '─'.repeat(50),
    '',
  ]

  tracks.forEach((track, i) => {
    const artist = track.artists[0]?.name || 'Unknown'
    const tempo = track.tempo ? ` (${track.tempo} BPM)` : ''
    lines.push(`${i + 1}. ${track.name} — ${artist}${tempo}`)
  })

  lines.push('')
  lines.push('─'.repeat(50))
  lines.push('')
  lines.push('Pour importer dans Apple Music :')
  lines.push('1. Ouvrez Apple Music')
  lines.push('2. Créez une nouvelle playlist')
  lines.push('3. Recherchez chaque morceau et ajoutez-le')
  lines.push('')
  lines.push('Ou utilisez le raccourci Shortcuts Apple fourni !')

  return lines.join('\n')
}

/**
 * Download a text file
 */
export function downloadTextFile(content, filename) {
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

/**
 * Generate Apple Shortcuts-compatible JSON for playlist creation
 * Users can import this into Apple Shortcuts to auto-create the playlist
 */
export function exportAsShortcutData(tracks, tempoLabel) {
  const data = {
    playlistName: `TempoMaker — ${tempoLabel}`,
    tracks: tracks.map((t) => ({
      name: t.name,
      artist: t.artists[0]?.name || 'Unknown',
      album: t.album?.name || '',
    })),
  }

  const json = JSON.stringify(data, null, 2)
  const blob = new Blob([json], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `tempomaker-${tempoLabel.toLowerCase().replace(/\s+/g, '-')}.json`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

/**
 * Copy playlist to clipboard in a format easy to search on Apple Music
 */
export async function copyPlaylistToClipboard(tracks) {
  const text = tracks
    .map((t) => `${t.name} — ${t.artists[0]?.name || 'Unknown'}`)
    .join('\n')

  await navigator.clipboard.writeText(text)
}
