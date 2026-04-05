import { execFile } from 'child_process'
import { writeFile, unlink } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { promisify } from 'util'
import {
  isLikelyRealArtistName,
  normalizeLoose,
  normalizeTrackTitleForMatch,
  normalizeTrackKey,
  parseAddedInfo,
  sanitizeTempoRange,
  scoreAppleMusicCandidate,
  tempoMidpoint,
} from '../utils/appleMusicCriteria.js'

const exec = promisify(execFile)

function getCatalogConfig() {
  const developerToken = String(process.env.APPLE_MUSIC_DEVELOPER_TOKEN || '').trim()
  const userToken = String(process.env.APPLE_MUSIC_USER_TOKEN || '').trim()
  const storefront = String(process.env.APPLE_MUSIC_STOREFRONT || 'fr').trim().toLowerCase()
  const enabled = developerToken.length > 0 && userToken.length > 0

  return {
    enabled,
    developerToken,
    userToken,
    storefront: storefront || 'fr',
  }
}

function sendJson(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(data))
}

/**
 * Clean track name for better search
 */
function cleanName(name) {
  return String(name || '')
    .replace(/\s*[\(\[].*?(feat|ft|with|radio|edit|remix|remaster|live|version|deluxe|bonus|explicit|clean|original mix|single).*?[\)\]]/gi, '')
    .replace(/\s*[-–]\s*(feat|ft|with)\.?\s.*/gi, '')
    .replace(/\s*[-–]\s*(radio edit|remaster(ed)?|live|single|version|deluxe|original mix).*/gi, '')
    .replace(/\s*\(.*?\)\s*/g, ' ')
    .replace(/\s*\[.*?\]\s*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Generate multiple search queries from most specific to least specific
 */
function buildSearchQueries(trackName, artistName) {
  const clean = cleanName(trackName)
  const firstWords = clean.split(/\s+/).slice(0, 3).join(' ')
  const artist = String(artistName || '').replace(/&/g, '').trim()

  const queries = []
  if (trackName && artist) queries.push(`${trackName} ${artist}`)
  if (clean && artist) queries.push(`${clean} ${artist}`)
  if (clean) queries.push(clean)
  if (firstWords && artist) queries.push(`${firstWords} ${artist}`)
  if (trackName) queries.push(trackName)
  if (firstWords) queries.push(firstWords)

  const seen = new Set()
  return queries.filter((q) => {
    const key = q.toLowerCase()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function normalizeStyleTerms(styleTerms) {
  if (!Array.isArray(styleTerms)) return []

  const terms = []
  const seen = new Set()
  for (const term of styleTerms) {
    const raw = String(term || '').trim()
    const key = normalizeLoose(raw)
    if (!raw || !key || key.length < 3 || seen.has(key)) continue
    seen.add(key)
    terms.push(raw)
    if (terms.length >= 16) break
  }

  return terms
}

function extractTrackKeyFromInfo(info) {
  const parsed = parseAddedInfo(info)
  if (!parsed.name) return ''
  return normalizeTrackKey(parsed.name, parsed.artist)
}

function pickTargetTempo(rawTempo, fallbackTempo, tempoRange) {
  const numeric = Number(rawTempo)
  if (Number.isFinite(numeric) && numeric > 0) return Math.round(numeric)

  const rangeMid = tempoMidpoint(tempoRange)
  if (rangeMid > 0) return rangeMid

  const fallback = Number(fallbackTempo)
  if (Number.isFinite(fallback) && fallback > 0) return Math.round(fallback)

  return 0
}

function parseAddedOrFallback(info, fallbackName, fallbackArtist) {
  const parsed = parseAddedInfo(info)
  return {
    name: parsed.name || String(fallbackName || '').trim(),
    artist: parsed.artist || String(fallbackArtist || '').trim(),
  }
}

async function appleMusicApiRequest(config, path, { method = 'GET', body } = {}) {
  const response = await fetch(`https://api.music.apple.com${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${config.developerToken}`,
      'Music-User-Token': config.userToken,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  })

  const text = await response.text()
  let payload = null
  if (text) {
    try {
      payload = JSON.parse(text)
    } catch {
      payload = { raw: text }
    }
  }

  if (!response.ok) {
    const detail = payload?.errors?.[0]?.detail || payload?.raw || response.statusText
    throw new Error(`Apple Music API ${method} ${path} failed (${response.status}): ${detail}`)
  }

  return payload
}

function buildCatalogSearchQueries(track) {
  const mergedQueries = []
  const seen = new Set()
  const appendQueries = (name, artist) => {
    const list = buildSearchQueries(name, artist)
    for (const query of list) {
      const key = normalizeLoose(query)
      if (!key || seen.has(key)) continue
      seen.add(key)
      mergedQueries.push(query)
    }
  }

  appendQueries(track?.name, track?.artist)
  if (Array.isArray(track?.hints)) {
    for (const hint of track.hints) {
      appendQueries(hint?.name, hint?.artist)
      appendQueries(hint?.name, '')
    }
  }

  return mergedQueries.slice(0, 16)
}

function pickBestCatalogSong(track, songs) {
  if (!Array.isArray(songs) || songs.length === 0) return null

  const ranked = songs
    .map((song) => {
      const attrs = song?.attributes || {}
      const name = String(attrs.name || '')
      const artist = String(attrs.artistName || '')
      const score = scoreAppleMusicCandidate(track?.name || '', track?.artist || '', name, artist)
      return { song, name, artist, score }
    })
    .sort((a, b) => b.score - a.score)

  const top = ranked[0]
  if (!top) return null
  const minScore = isLikelyRealArtistName(track?.artist || '') ? 180 : 120
  if (top.score < minScore) return null
  return top
}

async function searchCatalogSongs(config, query, limit = 10) {
  const term = String(query || '').trim()
  if (!term) return []

  const path = `/v1/catalog/${encodeURIComponent(config.storefront)}/search?types=songs&limit=${Math.max(1, Math.min(25, limit))}&term=${encodeURIComponent(term)}`
  const payload = await appleMusicApiRequest(config, path)
  return payload?.results?.songs?.data || []
}

async function addCatalogSongToPlaylist(config, playlistId, songId) {
  const id = String(songId || '').trim()
  if (!id) return false

  const payload = {
    data: [{ id, type: 'songs' }],
  }

  await appleMusicApiRequest(
    config,
    `/v1/me/library/playlists/${encodeURIComponent(playlistId)}/tracks`,
    { method: 'POST', body: payload }
  )

  return true
}

async function createCatalogPlaylist(config, playlistName) {
  const payload = await appleMusicApiRequest(config, '/v1/me/library/playlists', {
    method: 'POST',
    body: {
      attributes: {
        name: playlistName,
        description: 'Created by TempoMaker',
      },
    },
  })

  const playlist = payload?.data?.[0]
  const playlistId = String(playlist?.id || '').trim()
  if (!playlistId) {
    throw new Error('Apple Music API did not return a playlist id')
  }

  return playlistId
}

async function createPlaylistFromCatalog(playlistName, tracks, criteria, config) {
  const styleTerms = normalizeStyleTerms(criteria?.styleTerms)
  const tempoRange = sanitizeTempoRange(criteria?.tempoRange)
  const requestedCount = Math.max(
    tracks.length,
    Number(criteria?.requestedCount) || tracks.length
  )
  const tempos = tracks
    .map((t) => Number(t.targetTempo))
    .filter((tempo) => Number.isFinite(tempo) && tempo > 0)
  const avgTempo = tempos.length > 0
    ? Math.round(tempos.reduce((sum, tempo) => sum + tempo, 0) / tempos.length)
    : tempoMidpoint(tempoRange)

  const playlistId = await createCatalogPlaylist(config, playlistName)
  console.log(`[AppleMusic] Created catalog playlist "${playlistName}" (${playlistId})`)

  let addedCount = 0
  let approxCount = 0
  const exportedTracks = []
  const usedSongIds = new Set()

  for (let i = 0; i < tracks.length; i++) {
    const track = tracks[i]
    const targetTempo = pickTargetTempo(track.targetTempo, avgTempo, tempoRange)

    let added = false
    let approx = false
    let chosenId = String(track.catalogId || '').trim()
    let chosenName = String(track.name || '').trim()
    let chosenArtist = String(track.artist || '').trim()
    let source = 'exact_id'
    let error = ''

    if (chosenId && !usedSongIds.has(chosenId)) {
      try {
        await addCatalogSongToPlaylist(config, playlistId, chosenId)
        added = true
      } catch (err) {
        error = String(err.message || err)
      }
    }

    if (!added) {
      const searchQueries = buildCatalogSearchQueries(track)
      for (const query of searchQueries) {
        try {
          const songs = await searchCatalogSongs(config, query, 10)
          const best = pickBestCatalogSong(track, songs)
          if (!best) continue

          const candidateId = String(best.song?.id || '').trim()
          if (!candidateId || usedSongIds.has(candidateId)) continue

          await addCatalogSongToPlaylist(config, playlistId, candidateId)
          chosenId = candidateId
          chosenName = best.name || chosenName
          chosenArtist = best.artist || chosenArtist
          source = 'exact_search'
          added = true
          break
        } catch (err) {
          error = String(err.message || err)
        }
      }
    }

    if (!added) {
      for (const styleTerm of styleTerms) {
        try {
          const songs = await searchCatalogSongs(config, styleTerm, 10)
          const candidate = songs.find((song) => {
            const candidateId = String(song?.id || '').trim()
            return candidateId && !usedSongIds.has(candidateId)
          })
          if (!candidate) continue

          const candidateId = String(candidate.id || '').trim()
          await addCatalogSongToPlaylist(config, playlistId, candidateId)
          const attrs = candidate.attributes || {}
          chosenId = candidateId
          chosenName = String(attrs.name || chosenName)
          chosenArtist = String(attrs.artistName || chosenArtist)
          source = 'approx_style'
          added = true
          approx = true
          break
        } catch (err) {
          error = String(err.message || err)
        }
      }
    }

    if (added) {
      addedCount++
      if (approx) approxCount++
      if (chosenId) usedSongIds.add(chosenId)
      exportedTracks.push({
        index: i,
        fill: false,
        added: true,
        approx,
        source,
        catalogId: chosenId,
        targetTempo,
        requestedName: String(track.name || ''),
        requestedArtist: String(track.artist || ''),
        name: chosenName,
        artist: chosenArtist,
      })
      const prefix = approx ? 'approx:' : ''
      console.log(`[AppleMusic] [${i + 1}/${requestedCount}] ${prefix}${chosenName} - ${chosenArtist}`)
      continue
    }

    exportedTracks.push({
      index: i,
      fill: false,
      added: false,
      approx: false,
      source: 'missing',
      targetTempo,
      requestedName: String(track.name || ''),
      requestedArtist: String(track.artist || ''),
      name: String(track.name || ''),
      artist: String(track.artist || ''),
      error: error || 'notfound',
    })
    console.log(`[AppleMusic] [${i + 1}/${requestedCount}] Not found: ${track.name} - ${track.artist}`)
  }

  const fallbackTerms = styleTerms.length > 0 ? styleTerms : ['pop', 'rock', 'dance', 'electro']
  let fillCursor = 0
  const fillAttemptsMax = Math.max(0, (requestedCount - addedCount) * 6)
  let fillAttempts = 0

  while (addedCount < requestedCount && fillAttempts < fillAttemptsMax) {
    const styleTerm = fallbackTerms[fillCursor % fallbackTerms.length]
    fillCursor++
    fillAttempts++

    try {
      const songs = await searchCatalogSongs(config, styleTerm, 10)
      const candidate = songs.find((song) => {
        const candidateId = String(song?.id || '').trim()
        return candidateId && !usedSongIds.has(candidateId)
      })
      if (!candidate) continue

      const candidateId = String(candidate.id || '').trim()
      await addCatalogSongToPlaylist(config, playlistId, candidateId)
      usedSongIds.add(candidateId)
      addedCount++
      approxCount++
      const attrs = candidate.attributes || {}
      exportedTracks.push({
        index: exportedTracks.length,
        fill: true,
        added: true,
        approx: true,
        source: 'fill_style',
        catalogId: candidateId,
        targetTempo: pickTargetTempo(avgTempo, 0, tempoRange),
        requestedName: '',
        requestedArtist: '',
        name: String(attrs.name || ''),
        artist: String(attrs.artistName || ''),
      })
      console.log(`[AppleMusic] [fill ${addedCount}/${requestedCount}] approx:${attrs.name} - ${attrs.artistName}`)
    } catch {
      // Ignore and keep trying with next term.
    }
  }

  console.log(`[AppleMusic] Done (catalog): ${addedCount}/${requestedCount} added to "${playlistName}" (${approxCount} approx)`) // eslint-disable-line max-len

  return {
    success: true,
    playlistName,
    totalTracks: requestedCount,
    addedTracks: addedCount,
    approxTracks: approxCount,
    exportedTracks,
    catalogSearch: true,
    catalogSearchReason: '',
  }
}

/**
 * Add a target track by exact-ish title+artist matching.
 */
async function addTrackToPlaylist(plNameFile, trackName, artistName, hints, index) {
  const mergedQueries = []
  const seenQueries = new Set()
  const appendQueries = (name, artist) => {
    const list = buildSearchQueries(name, artist)
    for (const query of list) {
      const key = query.toLowerCase()
      if (seenQueries.has(key)) continue
      seenQueries.add(key)
      mergedQueries.push(query)
    }
  }

  appendQueries(trackName, artistName)

  if (Array.isArray(hints)) {
    for (const hint of hints) {
      appendQueries(hint?.name, hint?.artist)
      appendQueries(hint?.name, '')
    }
  }

  const queries = mergedQueries
  const queriesFile = join(tmpdir(), `tempomaker-queries-${index}.txt`)
  await writeFile(queriesFile, queries.join('\n'), 'utf8')

  const enforceArtistMatch = isLikelyRealArtistName(artistName)
  const artistLower = enforceArtistMatch ? normalizeLoose(artistName) : ''
  const artistFile = join(tmpdir(), `tempomaker-artist-${index}.txt`)
  await writeFile(artistFile, artistLower, 'utf8')

  const trackLower = normalizeTrackTitleForMatch(trackName)
  const trackFile = join(tmpdir(), `tempomaker-track-${index}.txt`)
  await writeFile(trackFile, trackLower, 'utf8')

  const script = `
set plFile to POSIX file "${plNameFile}"
set plName to read plFile as «class utf8»
set qFile to POSIX file "${queriesFile}"
set qText to read qFile as «class utf8»
set aFile to POSIX file "${artistFile}"
set targetArtist to read aFile as «class utf8»
set tFile to POSIX file "${trackFile}"
set targetTrack to read tFile as «class utf8»
set queryList to paragraphs of qText

on normalizeForCompare(inputText)
  set asText to inputText as string
  set lowered to do shell script "printf %s " & quoted form of asText & " | tr '[:upper:]' '[:lower:]'"
  set asciiFolded to do shell script "printf %s " & quoted form of lowered & " | iconv -f UTF-8 -t ASCII//TRANSLIT 2>/dev/null || printf %s " & quoted form of lowered
  return do shell script "printf %s " & quoted form of asciiFolded & " | sed -E 's/&/ and /g; s/[^[:alnum:]]+/ /g; s/[[:space:]]+/ /g; s/^ //; s/ $//'"
end normalizeForCompare

on artistMatches(targetArtist, candidateArtist)
  if targetArtist is "" then return true

  set candidateNorm to my normalizeForCompare(candidateArtist)
  if candidateNorm is "" then return false

  if candidateNorm is targetArtist then return true
  if candidateNorm contains targetArtist then return true
  if targetArtist contains candidateNorm then return true
  return false
end artistMatches

on titleMatches(targetTitle, candidateTitle)
  if targetTitle is "" then return false

  set candidateNorm to my normalizeForCompare(candidateTitle)
  if candidateNorm is "" then return false

  if candidateNorm is targetTitle then return true
  if candidateNorm contains targetTitle then return true
  if targetTitle contains candidateNorm then return true
  return false
end titleMatches

tell application "Music"
  set targetPlaylists to every user playlist whose name is plName
  if (count of targetPlaylists) is 0 then
    return "noplaylist"
  end if
  set pl to item 1 of targetPlaylists

  repeat with q in queryList
    set searchQ to contents of q
    if searchQ is not "" then
      try
        set results to (search library playlist 1 for searchQ)
        if (count of results) > 0 then
          repeat with r in results
            try
              set rName to name of r as string
              set rArtist to artist of r as string
              if my artistMatches(targetArtist, rArtist) and my titleMatches(targetTrack, rName) then
                duplicate r to pl
                return "added:" & rName & " - " & rArtist
              end if
            end try
          end repeat
        end if
      end try
    end if
  end repeat

  return "notfound"
end tell
`

  try {
    const { stdout } = await exec('osascript', ['-e', script], { timeout: 30000 })
    await Promise.all([unlink(queriesFile), unlink(artistFile), unlink(trackFile)]).catch(() => {})
    const result = stdout.trim()
    if (result.startsWith('added:')) {
      return { added: true, info: result.slice(6) }
    }
    return { added: false, error: result }
  } catch (err) {
    await Promise.all([unlink(queriesFile), unlink(artistFile), unlink(trackFile)]).catch(() => {})
    return { added: false, error: (err.stderr || err.message).slice(0, 200) }
  }
}

/**
 * Approx fallback constrained by style + tempo, and excluding already used tracks.
 */
async function addApproxTrackToPlaylist(
  plNameFile,
  styleTerms,
  targetTempo,
  usedTrackKeys,
  index,
  allowReuse = false
) {
  const styleFile = join(tmpdir(), `tempomaker-style-${index}.txt`)
  await writeFile(styleFile, styleTerms.join('\n'), 'utf8')

  const usedFile = join(tmpdir(), `tempomaker-used-${index}.txt`)
  await writeFile(usedFile, Array.from(usedTrackKeys).join('\n'), 'utf8')

  const bpmFile = join(tmpdir(), `tempomaker-bpm-${index}.txt`)
  await writeFile(bpmFile, String(Math.max(0, Math.round(Number(targetTempo) || 0))), 'utf8')

  const script = `
set plFile to POSIX file "${plNameFile}"
set plName to read plFile as «class utf8»
set allowReuse to ${allowReuse ? 1 : 0}
set sFile to POSIX file "${styleFile}"
set sText to read sFile as «class utf8»
set styleList to paragraphs of sText
set uFile to POSIX file "${usedFile}"
set uText to read uFile as «class utf8»
set usedList to paragraphs of uText
set bpmFile to POSIX file "${bpmFile}"
set bpmText to read bpmFile as «class utf8»
set targetBpm to 0
try
  set targetBpm to bpmText as integer
end try

on normalizeForCompare(inputText)
  set asText to inputText as string
  set lowered to do shell script "printf %s " & quoted form of asText & " | tr '[:upper:]' '[:lower:]'"
  set asciiFolded to do shell script "printf %s " & quoted form of lowered & " | iconv -f UTF-8 -t ASCII//TRANSLIT 2>/dev/null || printf %s " & quoted form of lowered
  return do shell script "printf %s " & quoted form of asciiFolded & " | sed -E 's/&/ and /g; s/[^[:alnum:]]+/ /g; s/[[:space:]]+/ /g; s/^ //; s/ $//'"
end normalizeForCompare

on trackKey(trackName, trackArtist)
  set kName to my normalizeForCompare(trackName)
  set kArtist to my normalizeForCompare(trackArtist)
  return kName & "|" & kArtist
end trackKey

on isUsedKey(candidateKey, usedList)
  if candidateKey is "" then return true
  repeat with u in usedList
    set itemText to contents of u
    if itemText is candidateKey then return true
  end repeat
  return false
end isUsedKey

on styleMatches(styleQuery, trackGenre, trackName, trackArtist)
  if styleQuery is "" then return true

  set styleNorm to my normalizeForCompare(styleQuery)
  if styleNorm is "" then return true

  set genreNorm to my normalizeForCompare(trackGenre)
  set nameNorm to my normalizeForCompare(trackName)
  set artistNorm to my normalizeForCompare(trackArtist)

  if genreNorm contains styleNorm then return true
  if nameNorm contains styleNorm then return true
  if artistNorm contains styleNorm then return true

  return false
end styleMatches

on tempoMatches(targetBpm, trackBpm)
  if targetBpm is less than or equal to 0 then return true

  set bpmValue to 0
  try
    set bpmValue to trackBpm as integer
  end try

  if bpmValue is less than or equal to 0 then return true

  set diffBpm to bpmValue - targetBpm
  if diffBpm < 0 then set diffBpm to diffBpm * -1

  if diffBpm is less than or equal to 25 then return true
  return false
end tempoMatches

tell application "Music"
  set targetPlaylists to every user playlist whose name is plName
  if (count of targetPlaylists) is 0 then
    return "noplaylist"
  end if
  set pl to item 1 of targetPlaylists

  repeat with q in styleList
    set searchQ to contents of q
    if searchQ is not "" then
      try
        set results to (search library playlist 1 for searchQ)
        if (count of results) > 0 then
          repeat with r in results
            try
              set rName to name of r as string
              set rArtist to artist of r as string
              set rGenre to ""
              set rBpm to 0
              try
                set rGenre to genre of r as string
              end try
              try
                set rBpm to bpm of r as integer
              end try

              set rKey to my trackKey(rName, rArtist)
              if (not my isUsedKey(rKey, usedList)) then
                if my styleMatches(searchQ, rGenre, rName, rArtist) and my tempoMatches(targetBpm, rBpm) then
                  duplicate r to pl
                  return "added:approx:" & rName & " - " & rArtist
                end if
              end if
            end try
          end repeat
        end if
      end try
    end if
  end repeat

  repeat with q in styleList
    set searchQ to contents of q
    if searchQ is not "" then
      try
        set results to (search library playlist 1 for searchQ)
        if (count of results) > 0 then
          repeat with r in results
            try
              set rName to name of r as string
              set rArtist to artist of r as string
              set rGenre to ""
              try
                set rGenre to genre of r as string
              end try

              set rKey to my trackKey(rName, rArtist)
              if (not my isUsedKey(rKey, usedList)) then
                if my styleMatches(searchQ, rGenre, rName, rArtist) then
                  duplicate r to pl
                  return "added:approx:" & rName & " - " & rArtist
                end if
              end if
            end try
          end repeat
        end if
      end try
    end if
  end repeat

  return "notfound"
end tell
`

  try {
    const { stdout } = await exec('osascript', ['-e', script], { timeout: 30000 })
    await Promise.all([unlink(styleFile), unlink(usedFile), unlink(bpmFile)]).catch(() => {})
    const result = stdout.trim()
    if (result.startsWith('added:')) {
      return { added: true, info: result.slice(6) }
    }
    return { added: false, error: result }
  } catch (err) {
    await Promise.all([unlink(styleFile), unlink(usedFile), unlink(bpmFile)]).catch(() => {})
    return { added: false, error: (err.stderr || err.message).slice(0, 200) }
  }
}

/**
 * Last-resort approx fallback: pick any track from library.
 */
async function forceApproxTrackToPlaylist(plNameFile) {
  const script = `
set plFile to POSIX file "${plNameFile}"
set plName to read plFile as «class utf8»

tell application "Music"
  set targetPlaylists to every user playlist whose name is plName
  if (count of targetPlaylists) is 0 then
    return "noplaylist"
  end if
  set pl to item 1 of targetPlaylists

  set libTracks to tracks of library playlist 1
  set totalLib to count of libTracks
  if totalLib is 0 then return "notfound"

  set r to item 1 of libTracks
  set rName to name of r as string
  set rArtist to artist of r as string
  duplicate r to pl
  return "added:approx:" & rName & " - " & rArtist
end tell
`

  try {
    const { stdout } = await exec('osascript', ['-e', script], { timeout: 30000 })
    const result = stdout.trim()
    if (result.startsWith('added:')) {
      return { added: true, info: result.slice(6) }
    }
    return { added: false, error: result }
  } catch (err) {
    return { added: false, error: (err.stderr || err.message).slice(0, 200) }
  }
}

export default function appleMusicPlugin() {
  return {
    name: 'apple-music-local',
    configureServer(server) {
      server.middlewares.use('/api/apple-music/create-playlist', async (req, res) => {
        if (req.method !== 'POST') {
          sendJson(res, 405, { error: 'Method not allowed' })
          return
        }

        let body = ''
        req.on('data', (chunk) => { body += chunk })
        req.on('end', async () => {
          try {
            const { playlistName, tracks, criteria } = JSON.parse(body)

            if (!playlistName || !tracks?.length) {
              sendJson(res, 400, { error: 'Missing playlistName or tracks' })
              return
            }

            const catalogConfig = getCatalogConfig()
            if (catalogConfig.enabled) {
              const catalogResult = await createPlaylistFromCatalog(
                playlistName,
                tracks,
                criteria,
                catalogConfig
              )
              sendJson(res, 200, catalogResult)
              return
            }

            const styleTerms = normalizeStyleTerms(criteria?.styleTerms)
            const tempoRange = sanitizeTempoRange(criteria?.tempoRange)
            const requestedCount = Math.max(
              tracks.length,
              Number(criteria?.requestedCount) || tracks.length
            )

            const tempos = tracks
              .map((t) => Number(t.targetTempo))
              .filter((tempo) => Number.isFinite(tempo) && tempo > 0)
            const avgTempo = tempos.length > 0
              ? Math.round(tempos.reduce((sum, tempo) => sum + tempo, 0) / tempos.length)
              : tempoMidpoint(tempoRange)

            const plNameFile = join(tmpdir(), 'tempomaker-plname.txt')
            await writeFile(plNameFile, playlistName, 'utf8')

            const createScript = `
set plFile to POSIX file "${plNameFile}"
set plName to read plFile as «class utf8»
tell application "Music"
  activate
  delay 0.5
  make new user playlist with properties {name:plName}
  return "ok"
end tell`
            await exec('osascript', ['-e', createScript], { timeout: 15000 })
            console.log(`[AppleMusic] Created playlist "${playlistName}"`)

            let addedCount = 0
            let approxCount = 0
            const usedTrackKeys = new Set()
            const exportedTracks = []

            for (let i = 0; i < tracks.length; i++) {
              const t = tracks[i]
              const targetTempo = pickTargetTempo(t.targetTempo, avgTempo, tempoRange)
              const exactResult = await addTrackToPlaylist(plNameFile, t.name, t.artist, t.hints, i)

              if (exactResult.added) {
                addedCount++
                const key = extractTrackKeyFromInfo(exactResult.info)
                if (key) usedTrackKeys.add(key)
                const trackInfo = parseAddedOrFallback(exactResult.info, t.name, t.artist)
                exportedTracks.push({
                  index: i,
                  fill: false,
                  added: true,
                  approx: false,
                  source: 'exact',
                  targetTempo,
                  requestedName: String(t.name || ''),
                  requestedArtist: String(t.artist || ''),
                  name: trackInfo.name,
                  artist: trackInfo.artist,
                })
                console.log(`[AppleMusic] [${i + 1}/${requestedCount}] ${exactResult.info}`)
                continue
              }

              const approxResult = await addApproxTrackToPlaylist(
                plNameFile,
                styleTerms,
                targetTempo,
                usedTrackKeys,
                i,
                true
              )
              const fallbackResult = approxResult.added
                ? approxResult
                : await forceApproxTrackToPlaylist(plNameFile)

              if (fallbackResult.added) {
                addedCount++
                approxCount++
                const key = extractTrackKeyFromInfo(fallbackResult.info)
                if (key) usedTrackKeys.add(key)
                const trackInfo = parseAddedOrFallback(fallbackResult.info, t.name, t.artist)
                exportedTracks.push({
                  index: i,
                  fill: false,
                  added: true,
                  approx: true,
                  source: approxResult.added ? 'approx_style' : 'approx_force',
                  targetTempo,
                  requestedName: String(t.name || ''),
                  requestedArtist: String(t.artist || ''),
                  name: trackInfo.name,
                  artist: trackInfo.artist,
                })
                console.log(`[AppleMusic] [${i + 1}/${requestedCount}] ${fallbackResult.info}`)
              } else {
                exportedTracks.push({
                  index: i,
                  fill: false,
                  added: false,
                  approx: false,
                  source: 'missing',
                  targetTempo,
                  requestedName: String(t.name || ''),
                  requestedArtist: String(t.artist || ''),
                  name: String(t.name || ''),
                  artist: String(t.artist || ''),
                  error: String(fallbackResult.error || 'notfound'),
                })
                console.log(
                  `[AppleMusic] [${i + 1}/${requestedCount}] Not found (${fallbackResult.error}): ${t.name} - ${t.artist}`
                )
              }
            }

            const missing = Math.max(0, requestedCount - addedCount)
            const fillAttemptsMax = missing * 4
            let fillAttempts = 0

            while (addedCount < requestedCount && fillAttempts < fillAttemptsMax) {
              const fillTempo = pickTargetTempo(avgTempo, 0, tempoRange)
              const fillResult = await addApproxTrackToPlaylist(
                plNameFile,
                styleTerms,
                fillTempo,
                usedTrackKeys,
                tracks.length + fillAttempts,
                true
              )
              const finalFillResult = fillResult.added
                ? fillResult
                : await forceApproxTrackToPlaylist(plNameFile)
              fillAttempts++

              if (!finalFillResult.added) continue

              addedCount++
              approxCount++
              const key = extractTrackKeyFromInfo(finalFillResult.info)
              if (key) usedTrackKeys.add(key)
              const trackInfo = parseAddedOrFallback(finalFillResult.info, '', '')
              exportedTracks.push({
                index: exportedTracks.length,
                fill: true,
                added: true,
                approx: true,
                source: fillResult.added ? 'fill_style' : 'fill_force',
                targetTempo: fillTempo,
                requestedName: '',
                requestedArtist: '',
                name: trackInfo.name,
                artist: trackInfo.artist,
              })
              console.log(`[AppleMusic] [fill ${addedCount}/${requestedCount}] ${finalFillResult.info}`)
            }

            await exec('osascript', ['-e', 'tell application "Music" to pause'], { timeout: 5000 }).catch(() => {})
            await unlink(plNameFile).catch(() => {})

            console.log(`[AppleMusic] Done: ${addedCount}/${requestedCount} added to "${playlistName}" (${approxCount} approx)`) // eslint-disable-line max-len

            sendJson(res, 200, {
              success: true,
              playlistName,
              totalTracks: requestedCount,
              addedTracks: addedCount,
              approxTracks: approxCount,
              exportedTracks,
              catalogSearch: false,
              catalogSearchReason: 'Set APPLE_MUSIC_DEVELOPER_TOKEN and APPLE_MUSIC_USER_TOKEN to enable full Apple Music catalog search',
            })
          } catch (err) {
            console.error('[AppleMusic] Error:', err.message)
            sendJson(res, 500, { error: err.message })
          }
        })
      })
    },
  }
}
