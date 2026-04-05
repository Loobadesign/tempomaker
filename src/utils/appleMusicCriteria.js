function stripDiacritics(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
}

export function normalizeLoose(value) {
  return stripDiacritics(value)
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[’']/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function normalizeTrackTitleForMatch(value) {
  const raw = String(value || '')
  const cleaned = raw
    .replace(/\s*[\(\[].*?(feat|ft|with|radio|edit|remix|remaster|live|version|deluxe|bonus|explicit|clean|original mix|single).*?[\)\]]/gi, '')
    .replace(/\s*[-–]\s*(feat|ft|with)\.?\s.*/gi, '')
    .replace(/\s*[-–]\s*(radio edit|remaster(ed)?|live|single|version|deluxe|original mix).*/gi, '')
    .replace(/\s*\(.*?\)\s*/g, ' ')
    .replace(/\s*\[.*?\]\s*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return normalizeLoose(cleaned || raw)
}

const GENERIC_TERMS = new Set([
  'music',
  'hits',
  'hit',
  'top',
  'best',
  'playlist',
  'mix',
  'radio',
  'francais',
])

const GENERIC_ARTIST_TOKENS = new Set([
  ...GENERIC_TERMS,
  'alternative',
  'rock',
  'classics',
  'classic',
  'pop',
  'rap',
  'hip',
  'hop',
  'edm',
  'electro',
  'techno',
  'dance',
  'indie',
  'metal',
  'jazz',
  'blues',
  'country',
  'soul',
  'folk',
  'instrumental',
  'piano',
  'radio',
  'songs',
  'collection',
  'chill',
  'ambient',
  'relax',
  'relaxing',
  'study',
  'sleep',
  'favorites',
  'favourites',
  'best',
  'greatest',
  'soundtrack',
  'various',
  'artists',
  'usa',
  'and',
])

function addTerm(terms, seen, term) {
  const raw = String(term || '').trim()
  if (!raw) return

  const normalized = normalizeLoose(raw)
  if (!normalized || normalized.length < 3) return

  const tokens = normalized.split(' ').filter(Boolean)
  if (tokens.length === 1 && GENERIC_TERMS.has(tokens[0])) return

  if (seen.has(normalized)) return
  seen.add(normalized)
  terms.push(raw)
}

function splitGenreLabel(label) {
  return String(label || '')
    .split(/[\/,&|+]/g)
    .map((part) => part.trim())
    .filter(Boolean)
}

/**
 * Build style terms used for approximate fallback in Apple Music export.
 */
export function buildStyleTerms(selectedGenres = [], genreLabels = '') {
  const terms = []
  const seen = new Set()

  const genres = Array.isArray(selectedGenres) ? selectedGenres : []
  for (const genre of genres) {
    addTerm(terms, seen, genre?.label)

    const labelParts = splitGenreLabel(genre?.label)
    for (const part of labelParts) addTerm(terms, seen, part)

    if (Array.isArray(genre?.queries)) {
      for (const query of genre.queries) addTerm(terms, seen, query)
    }
  }

  if (genreLabels) {
    const extraLabels = String(genreLabels)
      .split(',')
      .map((label) => label.trim())
      .filter(Boolean)
    for (const label of extraLabels) {
      addTerm(terms, seen, label)
      const parts = splitGenreLabel(label)
      for (const part of parts) addTerm(terms, seen, part)
    }
  }

  return terms.slice(0, 16)
}

function tokenOverlapRatio(left, right) {
  const leftTokens = new Set(String(left || '').split(' ').filter((t) => t.length > 1))
  const rightTokens = new Set(String(right || '').split(' ').filter((t) => t.length > 1))
  if (leftTokens.size === 0 || rightTokens.size === 0) return 0

  let overlap = 0
  for (const token of leftTokens) {
    if (rightTokens.has(token)) overlap++
  }

  return overlap / Math.max(leftTokens.size, rightTokens.size)
}

export function isLikelyRealArtistName(value) {
  const normalized = normalizeLoose(value)
  if (!normalized) return false
  if (normalized === 'unknown') return false
  if (normalized.includes('various artists')) return false
  if (normalized.includes('playlist')) return false

  const tokens = normalized.split(' ').filter(Boolean)
  if (tokens.length === 0) return false

  const genericCount = tokens.filter((token) => GENERIC_ARTIST_TOKENS.has(token)).length
  if (genericCount === tokens.length) return false

  const hasStrongToken = tokens.some((token) => token.length >= 3 && !GENERIC_ARTIST_TOKENS.has(token))
  return hasStrongToken
}

function scoreTitleSimilarity(targetTitle, candidateTitle) {
  if (!targetTitle || !candidateTitle) return 0
  if (targetTitle === candidateTitle) return 140
  if (targetTitle.includes(candidateTitle) || candidateTitle.includes(targetTitle)) return 100
  return Math.round(tokenOverlapRatio(targetTitle, candidateTitle) * 90)
}

function scoreArtistSimilarity(targetArtist, candidateArtist) {
  if (!targetArtist || !candidateArtist) return 0
  if (targetArtist === candidateArtist) return 100
  if (targetArtist.includes(candidateArtist) || candidateArtist.includes(targetArtist)) return 75
  return Math.round(tokenOverlapRatio(targetArtist, candidateArtist) * 70)
}

export function scoreAppleMusicCandidate(inputName, inputArtist, candidateName, candidateArtist) {
  const targetTitle = normalizeTrackTitleForMatch(inputName)
  const candidateTitle = normalizeTrackTitleForMatch(candidateName)
  if (!targetTitle || !candidateTitle) return -1

  const targetArtist = normalizeLoose(inputArtist)
  const candidateArtistNorm = normalizeLoose(candidateArtist)
  const targetArtistIsReliable = isLikelyRealArtistName(inputArtist)
  const candidateArtistIsReliable = isLikelyRealArtistName(candidateArtist)

  let score = scoreTitleSimilarity(targetTitle, candidateTitle)
  if (targetArtistIsReliable) {
    score += scoreArtistSimilarity(targetArtist, candidateArtistNorm)
  }

  if (candidateArtistIsReliable) {
    score += 10
  } else {
    score -= 45
  }

  return score
}

export function sanitizeTempoRange(input) {
  const min = Number(input?.min)
  const max = Number(input?.max)

  if (!Number.isFinite(min) || !Number.isFinite(max) || max < min) {
    return null
  }

  return { min, max }
}

export function tempoMidpoint(range) {
  const safe = sanitizeTempoRange(range)
  if (!safe) return 0
  return Math.round((safe.min + safe.max) / 2)
}

export function normalizeTrackKey(name, artist) {
  return `${normalizeLoose(name)}|${normalizeLoose(artist)}`
}

export function parseAddedInfo(info) {
  const raw = String(info || '').trim()
  if (!raw) return { name: '', artist: '' }

  const value = raw.startsWith('approx:') ? raw.slice(7).trim() : raw
  const idx = value.lastIndexOf(' - ')
  if (idx === -1) return { name: value, artist: '' }

  return {
    name: value.slice(0, idx).trim(),
    artist: value.slice(idx + 3).trim(),
  }
}
