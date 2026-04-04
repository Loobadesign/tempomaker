import { execFile } from 'child_process'
import { writeFile, unlink } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { promisify } from 'util'

const exec = promisify(execFile)

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
  // Most specific first
  if (trackName && artist) queries.push(`${trackName} ${artist}`)
  if (clean && artist) queries.push(`${clean} ${artist}`)
  if (clean) queries.push(clean)
  if (firstWords && artist) queries.push(`${firstWords} ${artist}`)
  if (trackName) queries.push(trackName)
  if (firstWords) queries.push(firstWords)
  if (artist) queries.push(artist)

  // Deduplicate
  const seen = new Set()
  return queries.filter((q) => {
    const key = q.toLowerCase()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/**
 * Write search queries to a temp file, one per line.
 * AppleScript reads them and tries each until one matches.
 */
async function addTrackToPlaylist(plNameFile, trackName, artistName, index) {
  const queries = buildSearchQueries(trackName, artistName)
  const queriesFile = join(tmpdir(), `tempomaker-queries-${index}.txt`)
  await writeFile(queriesFile, queries.join('\n'), 'utf8')

  const artistLower = String(artistName || '').toLowerCase()
  const artistFile = join(tmpdir(), `tempomaker-artist-${index}.txt`)
  await writeFile(artistFile, artistLower, 'utf8')

  const script = `
set plFile to POSIX file "${plNameFile}"
set plName to read plFile as «class utf8»
set qFile to POSIX file "${queriesFile}"
set qText to read qFile as «class utf8»
set aFile to POSIX file "${artistFile}"
set targetArtist to read aFile as «class utf8»
set queryList to paragraphs of qText

tell application "Music"
  set targetPlaylists to every user playlist whose name is plName
  if (count of targetPlaylists) is 0 then
    return "noplaylist"
  end if
  set pl to item 1 of targetPlaylists

  -- Try each search query from most specific to least
  repeat with q in queryList
    set searchQ to contents of q
    if searchQ is not "" then
      try
        set results to (search library playlist 1 for searchQ)
        if (count of results) > 0 then
          -- Try to find one where artist matches
          repeat with r in results
            try
              set rArtist to artist of r as string
              set rArtistLower to do shell script "echo " & quoted form of rArtist & " | tr '[:upper:]' '[:lower:]'"
              if rArtistLower contains targetArtist or targetArtist contains rArtistLower then
                duplicate r to pl
                return "added:" & (name of r) & " - " & rArtist
              end if
            end try
          end repeat
        end if
      end try
    end if
  end repeat

  -- Last resort: take first result from the broadest query that returns anything
  repeat with q in queryList
    set searchQ to contents of q
    if searchQ is not "" then
      try
        set results to (search library playlist 1 for searchQ)
        if (count of results) > 0 then
          set r to item 1 of results
          duplicate r to pl
          return "added:approx:" & (name of r) & " - " & (artist of r)
        end if
      end try
    end if
  end repeat

  return "notfound"
end tell
`

  try {
    const { stdout } = await exec('osascript', ['-e', script], { timeout: 30000 })
    await Promise.all([unlink(queriesFile), unlink(artistFile)]).catch(() => {})
    const result = stdout.trim()
    if (result.startsWith('added:')) {
      return { added: true, info: result.slice(6) }
    }
    return { added: false, error: result }
  } catch (err) {
    await Promise.all([unlink(queriesFile), unlink(artistFile)]).catch(() => {})
    return { added: false, error: (err.stderr || err.message).slice(0, 100) }
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
            const { playlistName, tracks } = JSON.parse(body)

            if (!playlistName || !tracks?.length) {
              sendJson(res, 400, { error: 'Missing playlistName or tracks' })
              return
            }

            const plNameFile = join(tmpdir(), 'tempomaker-plname.txt')
            await writeFile(plNameFile, playlistName, 'utf8')

            // Step 1: Create the playlist
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

            // Step 2: Add each track
            let addedCount = 0

            for (let i = 0; i < tracks.length; i++) {
              const t = tracks[i]
              const result = await addTrackToPlaylist(plNameFile, t.name, t.artist, i)

              if (result.added) {
                addedCount++
                console.log(`[AppleMusic] [${i + 1}/${tracks.length}] ${result.info}`)
              } else {
                console.log(`[AppleMusic] [${i + 1}/${tracks.length}] Not found: ${t.name} - ${t.artist}`)
              }
            }

            // Cleanup
            await exec('osascript', ['-e', 'tell application "Music" to pause'], { timeout: 5000 }).catch(() => {})
            await unlink(plNameFile).catch(() => {})

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
