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

            // Process tracks one at a time using individual osascript calls
            // This is more reliable than one big script

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

            // Step 2: For each track, open URL then add to playlist
            let addedCount = 0

            for (let i = 0; i < tracks.length; i++) {
              const t = tracks[i]
              const safeName2 = escapeAS(playlistName)
              const safeUrl = escapeAS(t.url)
              const safeTName = escapeAS(t.name)
              const safeTArtist = escapeAS(t.artist)

              const addScript = `
tell application "Music"
  -- Open the Apple Music URL
  open location "${safeUrl}"
  delay 3

  -- Get the track that's currently selected/playing
  set targetPlaylist to (first user playlist whose name is "${safeName2}")

  -- Try to find the track by searching
  set searchQ to "${safeTName} ${safeTArtist}"
  set results to (search library playlist 1 for searchQ)

  if (count of results) > 0 then
    -- Find the best match (exact name match)
    repeat with r in results
      if name of r contains "${safeTName}" then
        duplicate r to targetPlaylist
        return "added"
      end if
    end repeat
    -- Fallback: add the first result
    duplicate item 1 of results to targetPlaylist
    return "added"
  end if

  -- Fallback: search by name only
  set results2 to (search library playlist 1 for "${safeTName}")
  if (count of results2) > 0 then
    duplicate item 1 of results2 to targetPlaylist
    return "added"
  end if

  return "notfound"
end tell`

              try {
                const { stdout } = await exec('osascript', ['-e', addScript], {
                  timeout: 15000,
                })
                const result = stdout.trim()
                if (result === 'added') {
                  addedCount++
                  console.log(`[AppleMusic] [${i + 1}/${tracks.length}] Added: ${t.name} - ${t.artist}`)
                } else {
                  console.log(`[AppleMusic] [${i + 1}/${tracks.length}] Not found: ${t.name} - ${t.artist}`)
                }
              } catch (err) {
                console.log(`[AppleMusic] [${i + 1}/${tracks.length}] Error: ${t.name} - ${err.message}`)
              }
            }

            // Step 3: Reveal the playlist
            const revealScript = `
tell application "Music"
  set targetPlaylist to (first user playlist whose name is "${safeName}")
  reveal targetPlaylist
end tell`
            await exec('osascript', ['-e', revealScript], { timeout: 10000 }).catch(() => {})

            console.log(`[AppleMusic] Done: ${addedCount}/${tracks.length} added`)

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
