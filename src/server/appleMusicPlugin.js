import { execFile } from 'child_process'
import { promisify } from 'util'

const exec = promisify(execFile)

function escapeAS(str) {
  return String(str || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

function sendJson(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(data))
}

/**
 * Strategy: For each track, open its Apple Music URL,
 * play the track (this adds it to the library),
 * then duplicate the current track to the playlist.
 * This works with the full Apple Music catalog, not just local library.
 */
function buildAddScript(playlistName, trackUrl) {
  const safePl = escapeAS(playlistName)
  const safeUrl = escapeAS(trackUrl)

  return `
tell application "Music"
  -- Open the Apple Music URL (navigates to the song)
  open location "${safeUrl}"
  delay 2

  -- Play the track — this adds it to the library
  play
  delay 2

  -- Now current track should be the one we want
  set ct to current track
  set ctName to name of ct
  set ctArtist to artist of ct

  -- Stop playback
  pause

  -- Duplicate the current track to our playlist
  set targetPlaylist to (first user playlist whose name is "${safePl}")
  duplicate ct to targetPlaylist

  return "added:" & ctName & " - " & ctArtist
end tell
`
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
            const { playlistName, tracks } = JSON.parse(body)

            if (!playlistName || !tracks?.length) {
              sendJson(res, 400, { error: 'Missing playlistName or tracks' })
              return
            }

            const safeName = escapeAS(playlistName)

            // Step 1: Create the playlist
            const createScript = `
tell application "Music"
  activate
  delay 0.5
  make new user playlist with properties {name:"${safeName}"}
  return "ok"
end tell`
            await exec('osascript', ['-e', createScript], { timeout: 15000 })
            console.log(`[AppleMusic] Created playlist "${playlistName}"`)

            // Step 2: Add each track by opening URL + playing + duplicating
            let addedCount = 0

            for (let i = 0; i < tracks.length; i++) {
              const t = tracks[i]

              try {
                const script = buildAddScript(playlistName, t.url)
                const { stdout } = await exec('osascript', ['-e', script], {
                  timeout: 20000,
                })
                const result = stdout.trim()
                if (result.startsWith('added:')) {
                  addedCount++
                  const actualTrack = result.slice(6)
                  console.log(`[AppleMusic] [${i + 1}/${tracks.length}] Added: ${actualTrack}`)
                }
              } catch (err) {
                console.log(`[AppleMusic] [${i + 1}/${tracks.length}] Failed: ${t.name} - ${t.artist} (${err.message.slice(0, 60)})`)
              }
            }

            // Step 3: Stop playback & reveal playlist
            const finalScript = `
tell application "Music"
  try
    pause
  end try
  try
    set targetPlaylist to (first user playlist whose name is "${safeName}")
    reveal targetPlaylist
  end try
end tell`
            await exec('osascript', ['-e', finalScript], { timeout: 10000 }).catch(() => {})

            console.log(`[AppleMusic] Done: ${addedCount}/${tracks.length} added to "${playlistName}"`)

            sendJson(res, 200, {
              success: true,
              playlistName,
              totalTracks: tracks.length,
              addedTracks: addedCount,
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
