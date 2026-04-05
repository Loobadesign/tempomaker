import test from 'node:test'
import assert from 'node:assert/strict'

import { mergeExportedTracks } from '../src/utils/appleMusic.js'

test('mergeExportedTracks replaces slots with exported approx tracks and appends fill tracks', () => {
  const originalTracks = [{
    id: 11,
    name: 'Original Song',
    artists: [{ name: 'Original Artist' }],
    tempo: 126,
  }]

  const exportedTracks = [
    {
      index: 0,
      fill: false,
      added: true,
      approx: true,
      targetTempo: 130,
      name: 'Approx Song',
      artist: 'Approx Artist',
    },
    {
      index: 1,
      fill: true,
      added: true,
      approx: true,
      targetTempo: 128,
      name: 'Fill Song',
      artist: 'Fill Artist',
    },
  ]

  const merged = mergeExportedTracks(originalTracks, exportedTracks)
  assert.equal(merged.length, 2)

  assert.equal(merged[0].name, 'Approx Song')
  assert.equal(merged[0].artists[0].name, 'Approx Artist')
  assert.equal(merged[0].approx, true)
  assert.equal(merged[0].tempo, 130)

  assert.equal(merged[1].name, 'Fill Song')
  assert.equal(merged[1].artists[0].name, 'Fill Artist')
  assert.equal(merged[1].approx, true)
  assert.equal(merged[1].tempo, 128)
})

test('mergeExportedTracks keeps original when no exported slot is available', () => {
  const originalTracks = [{
    id: 22,
    name: 'Keep Me',
    artists: [{ name: 'Artist' }],
    tempo: 118,
  }]

  const merged = mergeExportedTracks(originalTracks, [
    { index: 0, fill: false, added: false, approx: false, name: 'Missing', artist: 'Nobody' },
  ])

  assert.equal(merged.length, 1)
  assert.equal(merged[0].name, 'Keep Me')
  assert.equal(merged[0].artists[0].name, 'Artist')
  assert.equal(Boolean(merged[0].approx), false)
})

test('mergeExportedTracks ignores empty exported list and returns originals', () => {
  const originalTracks = [{
    id: 77,
    name: 'Original',
    artists: [{ name: 'Original Artist' }],
    tempo: 122,
  }]

  assert.deepEqual(mergeExportedTracks(originalTracks, []), originalTracks)
  assert.deepEqual(mergeExportedTracks(originalTracks, null), originalTracks)
})
