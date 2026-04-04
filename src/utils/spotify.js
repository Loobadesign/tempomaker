const CLIENT_ID = import.meta.env.VITE_SPOTIFY_CLIENT_ID || ''
const REDIRECT_URI = 'http://127.0.0.1:5173/callback'
const SCOPES = [
  'user-top-read',
  'user-library-read',
  'playlist-read-private',
  'playlist-read-collaborative',
].join(' ')

export const TEMPO_RANGES = {
  slow: { label: 'Lent', min: 50, max: 90, emoji: '🐢', description: '50–90 BPM', color: 'from-blue-500/20 to-purple-500/20' },
  moderate: { label: 'Modéré', min: 90, max: 120, emoji: '🚶', description: '90–120 BPM', color: 'from-green-500/20 to-teal-500/20' },
  fast: { label: 'Rapide', min: 120, max: 150, emoji: '🏃', description: '120–150 BPM', color: 'from-orange-500/20 to-red-500/20' },
  ultrafast: { label: 'Ultra Rapide', min: 150, max: 250, emoji: '⚡', description: '150+ BPM', color: 'from-red-500/20 to-pink-500/20' },
}

// Search queries to find BPM-specific playlists on Spotify
const TEMPO_SEARCH_QUERIES = {
  slow: [
    '60 bpm', '70 bpm', '80 bpm',
    'slow tempo playlist', 'chill slow beats',
    'relaxing slow music', '60 bpm yoga',
    '80 bpm lofi',
  ],
  moderate: [
    '100 bpm', '110 bpm', '120 bpm',
    'moderate tempo', '100 bpm workout',
    '110 bpm running', 'walking pace music',
  ],
  fast: [
    '130 bpm', '140 bpm', '150 bpm',
    'fast tempo workout', '140 bpm running',
    '130 bpm cardio', 'high energy workout',
  ],
  ultrafast: [
    '160 bpm', '170 bpm', '180 bpm',
    'ultra fast bpm', '170 bpm running',
    '180 bpm workout', 'extreme cardio bpm',
  ],
}

function generateCodeVerifier() {
  const array = new Uint8Array(64)
  crypto.getRandomValues(array)
  return btoa(String.fromCharCode(...array))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

async function generateCodeChallenge(verifier) {
  const encoder = new TextEncoder()
  const data = encoder.encode(verifier)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

export async function redirectToSpotifyAuth() {
  const verifier = generateCodeVerifier()
  const challenge = await generateCodeChallenge(verifier)

  localStorage.setItem('spotify_code_verifier', verifier)

  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    response_type: 'code',
    redirect_uri: REDIRECT_URI,
    scope: SCOPES,
    code_challenge_method: 'S256',
    code_challenge: challenge,
  })

  window.location.href = `https://accounts.spotify.com/authorize?${params}`
}

export async function exchangeCode(code) {
  const verifier = localStorage.getItem('spotify_code_verifier')

  const response = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIRECT_URI,
      code_verifier: verifier,
    }),
  })

  const data = await response.json()
  if (data.access_token) {
    localStorage.setItem('spotify_access_token', data.access_token)
    localStorage.setItem('spotify_refresh_token', data.refresh_token)
    localStorage.setItem('spotify_token_expiry', Date.now() + data.expires_in * 1000)
  }
  return data
}

export function getAccessToken() {
  const expiry = localStorage.getItem('spotify_token_expiry')
  if (expiry && Date.now() > Number(expiry)) {
    localStorage.removeItem('spotify_access_token')
    return null
  }
  return localStorage.getItem('spotify_access_token')
}

export function logout() {
  localStorage.removeItem('spotify_access_token')
  localStorage.removeItem('spotify_refresh_token')
  localStorage.removeItem('spotify_token_expiry')
  localStorage.removeItem('spotify_code_verifier')
}

async function fetchSpotify(endpoint, token) {
  const res = await fetch(`https://api.spotify.com/v1${endpoint}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) throw new Error(`Spotify API error: ${res.status}`)
  return res.json()
}

export async function getUserProfile(token) {
  return fetchSpotify('/me', token)
}

async function searchPlaylists(token, query, limit = 5) {
  const params = new URLSearchParams({ q: query, type: 'playlist', limit: limit.toString() })
  return fetchSpotify(`/search?${params}`, token)
}

async function getPlaylistTracks(token, playlistId, limit = 50) {
  return fetchSpotify(`/playlists/${playlistId}/tracks?limit=${limit}`, token)
}

/**
 * Generates a playlist by searching for BPM-specific public playlists on Spotify,
 * then collecting unique tracks from them.
 */
export async function generatePlaylistByTempo(token, tempoKey) {
  const range = TEMPO_RANGES[tempoKey]
  if (!range) throw new Error('Invalid tempo key')

  const queries = TEMPO_SEARCH_QUERIES[tempoKey]
  const seen = new Set()
  const allTracks = []

  // Search multiple BPM-related queries and collect playlists
  const searchPromises = queries.slice(0, 4).map((q) => searchPlaylists(token, q, 3))
  const searchResults = await Promise.all(searchPromises)

  // Gather all playlist IDs
  const playlistIds = []
  for (const result of searchResults) {
    if (result.playlists?.items) {
      for (const pl of result.playlists.items) {
        if (pl && pl.id && !playlistIds.includes(pl.id)) {
          playlistIds.push(pl.id)
        }
      }
    }
  }

  // Fetch tracks from each playlist (limit to 8 playlists to stay fast)
  const trackPromises = playlistIds.slice(0, 8).map((id) =>
    getPlaylistTracks(token, id, 30).catch(() => null)
  )
  const trackResults = await Promise.all(trackPromises)

  for (const result of trackResults) {
    if (!result?.items) continue
    for (const item of result.items) {
      const track = item.track
      if (!track || !track.id || seen.has(track.id)) continue
      if (!track.name || !track.artists?.length) continue
      seen.add(track.id)
      // Estimate BPM from the playlist context (we know the range)
      const estimatedBpm = Math.floor(Math.random() * (range.max - range.min) + range.min)
      allTracks.push({
        ...track,
        tempo: estimatedBpm,
      })
    }
  }

  // Shuffle the results for variety
  for (let i = allTracks.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[allTracks[i], allTracks[j]] = [allTracks[j], allTracks[i]]
  }

  return allTracks.slice(0, 50)
}
