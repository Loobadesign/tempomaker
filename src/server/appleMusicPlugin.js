import { execFile } from 'child_process'
import { mkdtemp, readFile, rm, writeFile } from 'fs/promises'
import os from 'os'
import path from 'path'
import { promisify } from 'util'

const exec = promisify(execFile)
const MAX_REQUEST_BODY_BYTES = 1_000_000
const TEMP_DIR_PREFIX = 'tempomaker-previews-'
const SHORTCUT_TEMP_DIR_PREFIX = 'tempomaker-shortcut-'
const DEFAULT_SHORTCUT_NAME = 'TempoMaker'
const DEFAULT_PLAYLIST_NAME = 'TempoMaker Import'

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(payload))
}

function escapeAppleScriptString(value) {
  return String(value ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\r?\n/g, ' ')
}

function toAppleScriptList(values) {
  return `{${values.map((value) => `"${escapeAppleScriptString(value)}"`).join(', ')}}`
}

function parseAppleScriptResults(stdout, tracks) {
  const lines = String(stdout || '').split(/\r?\n/).filter(Boolean)

  if (lines.length === 0) {
    return tracks.map((track) => ({
      name: track.name,
      artist: track.artist,
      added: false,
      source: 'none',
      error: 'No result from AppleScript',
    }))
  }

  return lines.map((line) => {
    const [name = '', artist = '', addedFlag = '0', source = 'unknown', ...rest] = line.split('\t')
    const error = rest.join('\t').trim()
    return {
      name,
      artist,
      added: addedFlag === '1',
      source,
      error: error || undefined,
    }
  })
}

function getPreviewExtension(previewUrl) {
  try {
    const pathname = new URL(previewUrl).pathname.toLowerCase()
    if (pathname.endsWith('.mp3')) return '.mp3'
    if (pathname.endsWith('.m4a')) return '.m4a'
  } catch {
    // noop
  }
  return '.m4a'
}

function normalizeShortcutName(value) {
  const name = String(value || '').trim()
  return name || DEFAULT_SHORTCUT_NAME
}

function normalizePlaylistName(value) {
  const name = String(value || '').trim()
  return name || DEFAULT_PLAYLIST_NAME
}

function clampInteger(value, min, max, fallback) {
  const num = Number(value)
  if (!Number.isFinite(num)) return fallback
  const int = Math.trunc(num)
  if (int < min) return min
  if (int > max) return max
  return int
}

async function runAppleScript(script, timeout = 30000) {
  const { stdout } = await exec('osascript', ['-e', script], {
    timeout,
    maxBuffer: 2 * 1024 * 1024,
  })
  return String(stdout || '').trim()
}

async function getPlaylistStats(playlistName) {
  const safeName = escapeAppleScriptString(playlistName)
  const script = `
set targetName to "${safeName}"
tell application "Music"
  set matches to (every user playlist whose name is targetName)
  set playlistCount to count of matches
  set maxTrackCount to 0
  repeat with p in matches
    try
      set trackCount to count of every track of p
      if trackCount > maxTrackCount then set maxTrackCount to trackCount
    end try
  end repeat
  return (playlistCount as string) & tab & (maxTrackCount as string)
end tell
`

  try {
    const raw = await runAppleScript(script)
    const [playlistCountRaw = '0', maxTrackCountRaw = '0'] = raw.split('\t')
    const playlistCount = clampInteger(Number(playlistCountRaw), 0, 10_000, 0)
    const maxTrackCount = clampInteger(Number(maxTrackCountRaw), 0, 100_000, 0)
    return {
      exists: playlistCount > 0,
      playlistCount,
      maxTrackCount,
    }
  } catch {
    return {
      exists: false,
      playlistCount: 0,
      maxTrackCount: 0,
    }
  }
}

async function ensurePlaylistExists(playlistName) {
  const safeName = escapeAppleScriptString(playlistName)
  const script = `
set targetName to "${safeName}"
tell application "Music"
  make new user playlist with properties {name:targetName}
  return targetName
end tell
`
  await runAppleScript(script, 60000)
}

async function revealPlaylist(playlistName) {
  const safeName = escapeAppleScriptString(playlistName)
  const script = `
set targetName to "${safeName}"
tell application "Music"
  set matches to (every user playlist whose name is targetName)
  if (count of matches) > 0 then
    reveal item 1 of matches
  end if
end tell
`
  await runAppleScript(script, 30000)
}

function buildShortcutPayload(playlistName, tracks) {
  return {
    name: playlistName,
    tracks: tracks.map((track) => `${track.name} - ${track.artist}`.trim()),
    items: tracks.map((track) => ({
      name: track.name,
      artist: track.artist,
      query: track.queryPrimary || `${track.name} ${track.artist}`.trim(),
    })),
  }
}

async function listInstalledShortcuts() {
  const { stdout } = await exec('shortcuts', ['list'], {
    timeout: 15000,
    maxBuffer: 2 * 1024 * 1024,
  })

  return String(stdout || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
}

async function runShortcutImport(playlistName, tracks, requestedShortcutName) {
  const safePlaylistName = normalizePlaylistName(playlistName)
  const shortcutName = normalizeShortcutName(requestedShortcutName)
  const installedShortcuts = await listInstalledShortcuts()
  const shortcutExists = installedShortcuts.some(
    (name) => name.toLowerCase() === shortcutName.toLowerCase()
  )

  if (!shortcutExists) {
    throw new Error(
      `Shortcut "${shortcutName}" introuvable. Crée-le dans l’app Raccourcis puis réessaie.`
    )
  }

  const payload = buildShortcutPayload(safePlaylistName, tracks)
  const tempDir = await mkdtemp(path.join(os.tmpdir(), SHORTCUT_TEMP_DIR_PREFIX))
  const inputPath = path.join(tempDir, 'shortcut-input.txt')
  const outputPath = path.join(tempDir, 'shortcut-output.json')

  try {
    await writeFile(inputPath, JSON.stringify(payload), 'utf8')

    const args = [
      'run',
      shortcutName,
      '--input-path',
      inputPath,
      '--output-path',
      outputPath,
    ]

    let stdout = ''
    try {
      const response = await exec('shortcuts', args, {
        timeout: 600000,
        maxBuffer: 5 * 1024 * 1024,
      })
      stdout = String(response.stdout || '')
    } catch (err) {
      const stderr = String(err?.stderr || '').trim()
      if (stderr) {
        if (stderr.includes('input of the shortcut could not be processed')) {
          throw new Error(
            `Shortcut "${shortcutName}" ne reçoit pas l’entrée attendue. Réimporte shortcuts/TempoMaker.shortcut et relance.`
          )
        }
        if (stderr.includes('MPErrorDomain error 5')) {
          throw new Error(
            'Apple Music a refusé l’ajout (MPErrorDomain 5). Vérifie Music > Settings > General > Sync Library activé, la connexion Apple Music active, puis relance.'
          )
        }
        throw new Error(`Shortcut "${shortcutName}" failed: ${stderr}`)
      }
      throw err
    }

    let outputText = ''
    try {
      outputText = await readFile(outputPath, 'utf8')
    } catch {
      outputText = stdout
    }

    let parsed = null
    try {
      parsed = JSON.parse(outputText || '{}')
    } catch {
      parsed = null
    }

    if (!parsed || typeof parsed !== 'object') {
      throw new Error(
        `Shortcut "${shortcutName}" n’a pas renvoyé de JSON valide. Réimporte shortcuts/TempoMaker.shortcut puis réessaie.`
      )
    }

    const totalTracks = clampInteger(parsed?.totalTracks, 0, tracks.length, tracks.length)
    const addedTracks = clampInteger(parsed?.addedTracks, 0, totalTracks, 0)
    const playlistCreated = parsed?.playlistCreated === 1 || parsed?.playlistCreated === true

    if (addedTracks > 0 && !playlistCreated) {
      throw new Error(
        `Shortcut "${shortcutName}" a trouvé des morceaux mais n’a pas créé la playlist. Réimporte shortcuts/TempoMaker.shortcut puis relance l’export.`
      )
    }

    const resultList = Array.isArray(parsed?.results)
      ? parsed.results.slice(0, tracks.length).map((item, index) => ({
          name: String(item?.name || tracks[index]?.name || ''),
          artist: String(item?.artist || tracks[index]?.artist || ''),
          added: item?.added !== false,
          source: String(item?.source || 'shortcut'),
          error: item?.error ? String(item.error) : undefined,
        }))
      : tracks.map((track, index) => ({
          name: track.name,
          artist: track.artist,
          added: index < addedTracks,
          source: 'shortcut',
        }))

    let playlistStats = await getPlaylistStats(safePlaylistName)
    if (!playlistStats.exists) {
      await ensurePlaylistExists(safePlaylistName)
      playlistStats = await getPlaylistStats(safePlaylistName)
    }

    if (!playlistStats.exists) {
      throw new Error(
        `Shortcut "${shortcutName}" a terminé, mais la playlist "${safePlaylistName}" est introuvable dans Music.`
      )
    }

    const verifiedAddedTracks = clampInteger(
      playlistStats.maxTrackCount,
      0,
      totalTracks,
      addedTracks
    )
    const verifiedResults = resultList.map((item, index) => ({
      ...item,
      added: index < verifiedAddedTracks ? item.added : false,
    }))

    await revealPlaylist(safePlaylistName).catch(() => {})

    return {
      method: 'shortcut',
      shortcutName,
      playlistName: safePlaylistName,
      totalTracks,
      addedTracks: verifiedAddedTracks,
      results: verifiedResults,
    }
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
}

async function downloadPreviewFiles(tracks) {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), TEMP_DIR_PREFIX))
  const previewPaths = new Array(tracks.length).fill('')

  for (let i = 0; i < tracks.length; i += 1) {
    const previewUrl = String(tracks[i]?.previewUrl || '').trim()
    if (!previewUrl) continue

    try {
      const response = await fetch(previewUrl)
      if (!response.ok) continue
      const bytes = new Uint8Array(await response.arrayBuffer())
      if (bytes.length === 0) continue

      const filePath = path.join(tempDir, `track-${i}${getPreviewExtension(previewUrl)}`)
      await writeFile(filePath, bytes)
      previewPaths[i] = filePath
    } catch {
      // Keep empty path if preview download fails.
    }
  }

  return { tempDir, previewPaths }
}

function createAppleMusicMiddleware() {
  return async (req, res) => {
    if (req.method !== 'POST') {
      sendJson(res, 405, { error: 'Method not allowed' })
      return
    }

    let body = ''
    req.on('data', (chunk) => {
      body += chunk
      if (body.length > MAX_REQUEST_BODY_BYTES) {
        req.destroy(new Error('Payload too large'))
      }
    })

    req.on('error', () => {
      if (!res.headersSent) {
        sendJson(res, 413, { error: 'Payload too large' })
      }
    })

    req.on('end', async () => {
      let tempDir = null

      try {
        let parsedBody
        try {
          parsedBody = JSON.parse(body || '{}')
        } catch {
          sendJson(res, 400, { error: 'Invalid JSON body' })
          return
        }

        const playlistName = normalizePlaylistName(parsedBody.playlistName)
        const { tracks } = parsedBody
        const allowPreviewFallback = parsedBody.allowPreviewFallback === true
        const useShortcut = parsedBody.useShortcut === true
        const shortcutName = parsedBody.shortcutName

        if (
          typeof playlistName !== 'string'
          || !Array.isArray(tracks)
          || tracks.length === 0
        ) {
          sendJson(res, 400, { error: 'Missing playlistName or tracks' })
          return
        }

        const normalizedTracks = tracks
          .map((track) => {
            const name = String(track?.name || '').trim()
            const artist = String(track?.artist || '').trim()
            const previewUrl = String(track?.previewUrl || '').trim()
            const cleanName = name
              .replace(/\(([^)]*(feat|ft|with)[^)]*)\)/gi, '')
              .replace(/\b(feat|ft|with)\.?\b.*/gi, '')
              .replace(/[-–]\s*(live|edit|version|remaster(ed)?)\b.*/gi, '')
              .trim()

            const shortName = cleanName.split(/\s+/).slice(0, 4).join(' ').trim()
            const queryPrimary = `${name} ${artist}`.trim()
            const queryByName = name
            const queryByCleanName = cleanName
            const queryByArtist = artist
            const queryByArtistAndShortName = `${artist} ${shortName}`.trim()
            return {
              name,
              artist,
              previewUrl,
              queryPrimary,
              queryByName,
              queryByCleanName,
              queryByArtist,
              queryByArtistAndShortName,
            }
          })
          .filter((track) => track.queryPrimary.length > 0 || track.queryByName.length > 0)

        if (normalizedTracks.length === 0) {
          sendJson(res, 400, { error: 'No valid tracks to process' })
          return
        }

        if (useShortcut) {
          const shortcutResult = await runShortcutImport(
            playlistName,
            normalizedTracks,
            shortcutName
          )
          sendJson(res, 200, {
            success: true,
            playlistName,
            ...shortcutResult,
          })
          return
        }

        const safePlaylistName = escapeAppleScriptString(playlistName)
        const trackQueriesPrimary = toAppleScriptList(normalizedTracks.map((track) => track.queryPrimary))
        const trackQueriesByName = toAppleScriptList(normalizedTracks.map((track) => track.queryByName))
        const trackQueriesByCleanName = toAppleScriptList(normalizedTracks.map((track) => track.queryByCleanName))
        const trackQueriesByArtist = toAppleScriptList(normalizedTracks.map((track) => track.queryByArtist))
        const trackQueriesByArtistAndShortName = toAppleScriptList(normalizedTracks.map((track) => track.queryByArtistAndShortName))
        const trackNames = toAppleScriptList(normalizedTracks.map((track) => track.name))
        const trackArtists = toAppleScriptList(normalizedTracks.map((track) => track.artist))

        let previewPaths = new Array(normalizedTracks.length).fill('')
        if (allowPreviewFallback) {
          const downloaded = await downloadPreviewFiles(normalizedTracks)
          tempDir = downloaded.tempDir
          previewPaths = downloaded.previewPaths
        }
        const trackPreviewPaths = toAppleScriptList(previewPaths)

        const appleScript = `
set playlistName to "${safePlaylistName}"
set trackQueriesPrimary to ${trackQueriesPrimary}
set trackQueriesByName to ${trackQueriesByName}
set trackQueriesByCleanName to ${trackQueriesByCleanName}
set trackQueriesByArtist to ${trackQueriesByArtist}
set trackQueriesByArtistAndShortName to ${trackQueriesByArtistAndShortName}
set trackNames to ${trackNames}
set trackArtists to ${trackArtists}
set trackPreviewPaths to ${trackPreviewPaths}
set allowPreviewFallback to ${allowPreviewFallback ? 'true' : 'false'}

tell application "Music"
  activate
  delay 0.2
  set pl to make new user playlist with properties {name:playlistName}
  set resultsText to ""

  repeat with i from 1 to count of trackQueriesPrimary
    set qPrimary to item i of trackQueriesPrimary
    set qByName to item i of trackQueriesByName
    set qByCleanName to item i of trackQueriesByCleanName
    set qByArtist to item i of trackQueriesByArtist
    set qByArtistAndShortName to item i of trackQueriesByArtistAndShortName
    set tName to item i of trackNames
    set tArtist to item i of trackArtists
    set previewPath to item i of trackPreviewPaths

    try
      set foundTrack to missing value
      set usedQuery to ""
      set candidateQueries to {qPrimary, qByName, qByCleanName, qByArtistAndShortName, qByArtist}

      repeat with candidateQuery in candidateQueries
        set cq to (contents of candidateQuery) as string
        if cq is not "" then
          set foundTracks to (search library playlist 1 for cq)
          if (count of foundTracks) > 0 then
            set foundTrack to item 1 of foundTracks
            set usedQuery to cq
            exit repeat
          end if
        end if
      end repeat

      if foundTrack is not missing value then
        duplicate foundTrack to pl
        set resultsText to resultsText & tName & tab & tArtist & tab & "1" & tab & "library" & tab & "" & linefeed
      else if allowPreviewFallback and previewPath is not "" then
        try
          add POSIX file previewPath to pl
          set resultsText to resultsText & tName & tab & tArtist & tab & "1" & tab & "preview" & tab & "" & linefeed
        on error previewErr
          set resultsText to resultsText & tName & tab & tArtist & tab & "0" & tab & "preview" & tab & previewErr & linefeed
        end try
      else
        set resultsText to resultsText & tName & tab & tArtist & tab & "0" & tab & "missing" & tab & "Not found in library" & linefeed
      end if
    on error errMsg
      set resultsText to resultsText & tName & tab & tArtist & tab & "0" & tab & "error" & tab & errMsg & linefeed
    end try
  end repeat

  try
    reveal pl
  end try

  return resultsText
end tell
`

        const { stdout } = await exec('osascript', ['-e', appleScript], {
          timeout: 180000,
          maxBuffer: 5 * 1024 * 1024,
        })

        const results = parseAppleScriptResults(stdout, normalizedTracks)
        const added = results.filter((track) => track.added).length

        sendJson(res, 200, {
          success: true,
          method: 'applescript',
          playlistName,
          totalTracks: normalizedTracks.length,
          addedTracks: added,
          results,
        })
      } catch (err) {
        console.error('AppleScript error:', err)
        sendJson(res, 500, { error: err.message })
      } finally {
        if (tempDir) {
          await rm(tempDir, { recursive: true, force: true })
        }
      }
    })
  }
}

/**
 * Vite plugin that adds a local API endpoint to create playlists
 * in the macOS Music.app via osascript (AppleScript).
 */
export default function appleMusicPlugin() {
  return {
    name: 'apple-music-local',
    configureServer(server) {
      server.middlewares.use('/api/apple-music/create-playlist', createAppleMusicMiddleware())
    },
    configurePreviewServer(server) {
      server.middlewares.use('/api/apple-music/create-playlist', createAppleMusicMiddleware())
    },
  }
}
