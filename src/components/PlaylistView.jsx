import { useState } from 'react'
import { TEMPO_RANGES } from '../utils/spotify'
import { exportToAppleMusic, copyPlaylistToClipboard } from '../utils/appleMusic'

function TrackRow({ track, index }) {
  const artist = track.artists[0]?.name || 'Unknown'
  const albumImg = track.album?.images?.[2]?.url || track.album?.images?.[0]?.url

  return (
    <div
      className="flex items-center gap-4 px-4 py-3 hover:bg-brand-dark-2 rounded-xl transition-colors group"
      style={{ animation: `slide-up 0.3s ease-out ${index * 0.03}s both` }}
    >
      <span className="text-sm text-brand-gray w-6 text-right font-mono">
        {index + 1}
      </span>

      {albumImg ? (
        <img src={albumImg} alt="" className="w-10 h-10 rounded-lg" />
      ) : (
        <div className="w-10 h-10 rounded-lg bg-brand-dark-3 flex items-center justify-center">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#888" strokeWidth="2">
            <path d="M9 18V5l12-2v13" />
            <circle cx="6" cy="18" r="3" />
            <circle cx="18" cy="16" r="3" />
          </svg>
        </div>
      )}

      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-brand-light truncate">{track.name}</div>
        <div className="text-xs text-brand-gray truncate">{artist}</div>
      </div>

      {track.tempo && (
        <span className="text-xs font-mono text-brand-yellow bg-brand-yellow/10 px-2 py-1 rounded-lg">
          {track.tempo} BPM
        </span>
      )}

      {track.preview_url && (
        <button
          onClick={() => new Audio(track.preview_url).play()}
          className="opacity-0 group-hover:opacity-100 transition-opacity text-brand-gray hover:text-brand-yellow"
          title="Aperçu 30s"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <polygon points="5 3 19 12 5 21 5 3" />
          </svg>
        </button>
      )}
    </div>
  )
}

export default function PlaylistView({ tracks, tempoKey, genreLabels, onBack }) {
  const [copied, setCopied] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [exportProgress, setExportProgress] = useState({ current: 0, total: 0 })
  const [exportDone, setExportDone] = useState(null) // number of exported tracks
  const range = TEMPO_RANGES[tempoKey]

  const playlistName = `TempoMaker — ${range.label}`

  const handleAppleMusicExport = async () => {
    setExporting(true)
    setExportDone(null)
    setExportProgress({ current: 0, total: tracks.length })

    try {
      const count = await exportToAppleMusic(tracks, playlistName, (current, total) => {
        setExportProgress({ current, total })
      })
      setExportDone(count)
    } catch (err) {
      console.error('Apple Music export error:', err)
    } finally {
      setExporting(false)
    }
  }

  const handleCopy = async () => {
    await copyPlaylistToClipboard(tracks)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="max-w-3xl mx-auto px-6 py-8">
      {/* Header */}
      <div className="flex items-center gap-4 mb-8">
        <button
          onClick={onBack}
          className="w-10 h-10 rounded-xl bg-brand-dark-2 border border-brand-dark-3 flex items-center justify-center text-brand-gray hover:text-brand-light hover:border-brand-gray/30 transition-all"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
        </button>

        <div className="flex-1">
          <div className="flex items-center gap-3">
            <span className="text-3xl">{range.emoji}</span>
            <div>
              <h2 className="text-2xl font-bold">
                Playlist <span className="text-brand-yellow">{range.label}</span>
              </h2>
              <p className="text-sm text-brand-gray">
                {tracks.length} morceaux &middot; {range.description}
                {genreLabels && <span> &middot; {genreLabels}</span>}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Main export button */}
      <button
        onClick={handleAppleMusicExport}
        disabled={exporting}
        className="w-full mb-4 flex items-center justify-center gap-3 px-6 py-4 bg-gradient-to-r from-pink-500 to-red-500 hover:from-pink-600 hover:to-red-600 disabled:opacity-70 text-white rounded-2xl text-lg font-bold transition-all hover:scale-[1.01] active:scale-[0.99] shadow-lg shadow-pink-500/20"
      >
        {exporting ? (
          <>
            <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
            Recherche sur Apple Music... {exportProgress.current}/{exportProgress.total}
          </>
        ) : exportDone ? (
          <>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
            {exportDone} morceaux exportés ! Ouvre le fichier .m3u
          </>
        ) : (
          <>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
              <path d="M23.994 6.124a9.23 9.23 0 00-.24-2.19c-.317-1.31-1.062-2.31-2.18-3.043a5.022 5.022 0 00-1.877-.726 10.496 10.496 0 00-1.564-.15c-.04-.003-.083-.01-.124-.013H5.986c-.152.01-.303.017-.455.026-.747.043-1.49.123-2.193.4-1.336.53-2.3 1.452-2.865 2.78-.192.448-.292.925-.363 1.408-.056.392-.088.785-.1 1.18 0 .032-.007.062-.01.093v12.223c.01.14.017.283.027.424.05.815.154 1.624.497 2.373.65 1.42 1.738 2.353 3.234 2.801.42.127.856.187 1.293.228.555.053 1.11.06 1.667.06h11.03c.525 0 1.048-.034 1.57-.1.823-.106 1.597-.35 2.296-.81a5.046 5.046 0 001.88-2.207c.186-.42.293-.87.37-1.324.113-.675.138-1.358.137-2.04-.002-3.8 0-7.595-.003-11.393zm-6.423 3.99v5.712c0 .417-.058.827-.244 1.206-.29.59-.76.962-1.388 1.14-.35.1-.706.166-1.068.192-.652.047-1.27-.032-1.82-.39-.96-.63-1.284-1.89-.707-2.87.256-.438.636-.725 1.1-.91.345-.137.71-.207 1.078-.263.58-.09 1.166-.136 1.73-.283.206-.054.4-.134.516-.348.066-.12.1-.258.1-.4V9.95c0-.19-.074-.36-.25-.444-.12-.058-.256-.07-.39-.05-.36.056-.72.12-1.076.19l-3.14.59c-.016.003-.032.01-.04.01-.34.07-.48.222-.5.568-.01.066 0 .133 0 .2v7.39c0 .4-.048.796-.213 1.17-.287.642-.79 1.04-1.468 1.218-.34.09-.688.14-1.04.168-.667.043-1.298-.038-1.858-.4-.937-.6-1.282-1.83-.752-2.8.267-.492.68-.793 1.18-.976.33-.12.672-.184 1.016-.237.6-.092 1.2-.14 1.782-.3.166-.044.33-.114.436-.278.076-.118.106-.262.103-.41V7.63c0-.256.053-.49.26-.676.14-.122.31-.183.493-.22.298-.06.598-.108.9-.162l3.257-.617c.497-.093.995-.19 1.495-.273.226-.037.457-.008.66.105.275.152.393.41.393.72v3.338z" />
            </svg>
            Exporter vers Apple Music
          </>
        )}
      </button>

      {exportDone && (
        <p className="text-center text-sm text-brand-gray mb-4">
          Double-clique sur le fichier <code className="bg-brand-dark-3 px-1.5 py-0.5 rounded text-brand-yellow text-xs">.m3u</code> téléchargé pour l'ouvrir dans Apple Music
        </p>
      )}

      {/* Secondary actions */}
      <div className="flex gap-3 mb-8">
        <button
          onClick={handleCopy}
          className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-brand-dark-2 border border-brand-dark-3 rounded-xl text-sm font-medium hover:border-brand-yellow/30 hover:text-brand-yellow transition-all"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
            <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
          </svg>
          {copied ? 'Copié !' : 'Copier la liste'}
        </button>
      </div>

      {/* Track list */}
      <div className="bg-brand-dark/50 rounded-2xl border border-brand-dark-3 overflow-hidden">
        <div className="px-4 py-3 border-b border-brand-dark-3 flex items-center gap-4 text-xs text-brand-gray uppercase tracking-wider font-medium">
          <span className="w-6 text-right">#</span>
          <span className="w-10" />
          <span className="flex-1">Titre</span>
          <span>BPM</span>
        </div>

        <div className="divide-y divide-brand-dark-3/50">
          {tracks.map((track, i) => (
            <TrackRow key={track.id} track={track} index={i} />
          ))}
        </div>

        {tracks.length === 0 && (
          <div className="py-16 text-center text-brand-gray">
            Aucun morceau trouvé pour ce tempo.
          </div>
        )}
      </div>
    </div>
  )
}
