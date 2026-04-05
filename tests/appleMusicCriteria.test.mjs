import test from 'node:test'
import assert from 'node:assert/strict'

import {
  buildStyleTerms,
  isLikelyRealArtistName,
  normalizeLoose,
  normalizeTrackTitleForMatch,
  normalizeTrackKey,
  parseAddedInfo,
  sanitizeTempoRange,
  scoreAppleMusicCandidate,
  tempoMidpoint,
} from '../src/utils/appleMusicCriteria.js'

test('normalizeLoose removes punctuation and accents', () => {
  assert.equal(normalizeLoose('Électro / EDM & Rock!'), 'electro edm and rock')
})

test('buildStyleTerms collects labels and queries without duplicates', () => {
  const terms = buildStyleTerms(
    [{
      label: 'Hip-Hop / Rap',
      queries: ['hip hop', 'rap hits', 'hip hop'],
    }],
    'Hip-Hop / Rap'
  )

  assert.ok(terms.includes('Hip-Hop / Rap'))
  assert.ok(terms.includes('Hip-Hop'))
  assert.ok(terms.includes('Rap'))

  const normalized = terms.map((term) => normalizeLoose(term))
  assert.ok(normalized.includes('hip hop'))
  assert.equal(new Set(normalized).size, normalized.length)
})

test('sanitizeTempoRange and tempoMidpoint are safe', () => {
  assert.deepEqual(sanitizeTempoRange({ min: 120, max: 150 }), { min: 120, max: 150 })
  assert.equal(tempoMidpoint({ min: 120, max: 150 }), 135)
  assert.equal(sanitizeTempoRange({ min: 150, max: 120 }), null)
  assert.equal(tempoMidpoint({ min: 150, max: 120 }), 0)
})

test('parseAddedInfo and normalizeTrackKey produce stable keys', () => {
  const parsed = parseAddedInfo('approx:Learn to Fly - Foo Fighters')
  assert.deepEqual(parsed, { name: 'Learn to Fly', artist: 'Foo Fighters' })

  const key = normalizeTrackKey(parsed.name, parsed.artist)
  assert.equal(key, 'learn to fly|foo fighters')
})

test('normalizeTrackTitleForMatch strips version noise', () => {
  const normalized = normalizeTrackTitleForMatch('Cold Hard Bitch (Edit #1) [Radio Edit]')
  assert.equal(normalized, 'cold hard bitch')
})

test('isLikelyRealArtistName filters generic labels', () => {
  assert.equal(isLikelyRealArtistName('Alternative & Rock'), false)
  assert.equal(isLikelyRealArtistName('Rock Classics'), false)
  assert.equal(isLikelyRealArtistName('The Black Keys'), true)
})

test('scoreAppleMusicCandidate prioritizes real artist over generic label', () => {
  const genericLabelScore = scoreAppleMusicCandidate(
    'Gold on the Ceiling',
    'The Black Keys',
    'Gold on the Ceiling',
    'Alternative & Rock'
  )
  const exactArtistScore = scoreAppleMusicCandidate(
    'Gold on the Ceiling',
    'The Black Keys',
    'Gold On the Ceiling',
    'The Black Keys'
  )
  assert.ok(exactArtistScore > genericLabelScore)
})
