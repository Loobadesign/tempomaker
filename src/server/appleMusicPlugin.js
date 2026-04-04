import { execFile } from 'child_process'
import { mkdtemp, rm, writeFile } from 'fs/promises'
import os from 'os'
import path from 'path'
import { promisify } from 'util'

const exec = promisify(execFile)
const MAX_REQUEST_BODY_BYTES = 1_000_000
const TEMP_DIR_PREFIX = 'tempomaker-previews-'

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

        const { playlistName, tracks } = parsedBody
        const allowPreviewFallback = parsedBody.allowPreviewFallback === true

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
            return {
              name,
              artist,
              previewUrl,
              query: `${name} ${artist}`.trim(),
            }
          })
          .filter((track) => track.query.length > 0)

        if (normalizedTracks.length === 0) {
          sendJson(res, 400, { error: 'No valid tracks to process' })
          return
        }

        const safePlaylistName = escapeAppleScriptString(playlistName)
        const trackQueries = toAppleScriptList(normalizedTracks.map((track) => track.query))
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
set trackQueries to ${trackQueries}
set trackNames to ${trackNames}
set trackArtists to ${trackArtists}
set trackPreviewPaths to ${trackPreviewPaths}
set allowPreviewFallback to ${allowPreviewFallback ? 'true' : 'false'}

tell application "Music"
  activate
  delay 0.2
  set pl to make new user playlist with properties {name:playlistName}
  set resultsText to ""

  repeat with i from 1 to count of trackQueries
    set q to item i of trackQueries
    set tName to item i of trackNames
    set tArtist to item i of trackArtists
    set previewPath to item i of trackPreviewPaths

    try
      set foundTracks to (search library playlist 1 for q)
      if (count of foundTracks) > 0 then
        duplicate item 1 of foundTracks to pl
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
