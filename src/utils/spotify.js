const CLIENT_ID = import.meta.env.VITE_SPOTIFY_CLIENT_ID || ''
const REDIRECT_URI = window.location.origin + '/callback'
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

export async function getTopTracks(token, timeRange = 'medium_term', limit = 50) {
  return fetchSpotify(`/me/top/tracks?time_range=${timeRange}&limit=${limit}`, token)
}

export async function getSavedTracks(token, limit = 50, offset = 0) {
  return fetchSpotify(`/me/tracks?limit=${limit}&offset=${offset}`, token)
}

export async function getAudioFeatures(token, trackIds) {
  const ids = trackIds.join(',')
  return fetchSpotify(`/audio-features?ids=${ids}`, token)
}

export async function getRecommendations(token, { seedTracks, targetTempo, minTempo, maxTempo, limit = 50 }) {
  const params = new URLSearchParams({
    seed_tracks: seedTracks.slice(0, 5).join(','),
    target_tempo: targetTempo.toString(),
    min_tempo: minTempo.toString(),
    max_tempo: maxTempo.toString(),
    limit: limit.toString(),
  })
  return fetchSpotify(`/recommendations?${params}`, token)
}

export async function searchTracks(token, query, limit = 50) {
  const params = new URLSearchParams({ q: query, type: 'track', limit: limit.toString() })
  return fetchSpotify(`/search?${params}`, token)
}

export async function generatePlaylistByTempo(token, tempoKey) {
  const range = TEMPO_RANGES[tempoKey]
  if (!range) throw new Error('Invalid tempo key')

  const targetTempo = (range.min + range.max) / 2

  // Step 1: Get user's top tracks
  const topTracks = await getTopTracks(token, 'medium_term', 50)
  const trackIds = topTracks.items.map((t) => t.id)

  // Step 2: Get audio features to find seed tracks in tempo range
  let seedTrackIds = []
  if (trackIds.length > 0) {
    const features = await getAudioFeatures(token, trackIds)
    const matchingFeatures = features.audio_features
      .filter((f) => f && f.tempo >= range.min && f.tempo <= range.max)

    seedTrackIds = matchingFeatures.slice(0, 5).map((f) => f.id)
  }

  // Step 3: If not enough seed tracks, use top tracks as seeds
  if (seedTrackIds.length === 0) {
    seedTrackIds = trackIds.slice(0, 5)
  }

  if (seedTrackIds.length === 0) {
    // Fallback: search for popular tracks
    const search = await searchTracks(token, 'top hits 2024', 50)
    seedTrackIds = search.tracks.items.slice(0, 5).map((t) => t.id)
  }

  // Step 4: Get recommendations based on tempo
  const recommendations = await getRecommendations(token, {
    seedTracks: seedTrackIds,
    targetTempo,
    minTempo: range.min,
    maxTempo: range.max,
    limit: 50,
  })

  // Step 5: Get audio features for recommendations to verify tempo
  const recTrackIds = recommendations.tracks.map((t) => t.id)
  let verifiedTracks = recommendations.tracks

  if (recTrackIds.length > 0) {
    const recFeatures = await getAudioFeatures(token, recTrackIds)
    const featureMap = {}
    recFeatures.audio_features.forEach((f) => {
      if (f) featureMap[f.id] = f
    })

    verifiedTracks = recommendations.tracks
      .filter((t) => {
        const f = featureMap[t.id]
        return f && f.tempo >= range.min - 5 && f.tempo <= range.max + 5
      })
      .map((t) => ({
        ...t,
        tempo: Math.round(featureMap[t.id].tempo),
      }))
  }

  // Also include matching tracks from user's library
  const allFeatures = await getAudioFeatures(token, trackIds)
  const featureMap = {}
  allFeatures.audio_features.forEach((f) => {
    if (f) featureMap[f.id] = f
  })

  const userMatchingTracks = topTracks.items
    .filter((t) => {
      const f = featureMap[t.id]
      return f && f.tempo >= range.min && f.tempo <= range.max
    })
    .map((t) => ({
      ...t,
      tempo: Math.round(featureMap[t.id].tempo),
    }))

  // Merge and deduplicate
  const seen = new Set()
  const allTracks = [...userMatchingTracks, ...verifiedTracks].filter((t) => {
    if (seen.has(t.id)) return false
    seen.add(t.id)
    return true
  })

  return allTracks
}
