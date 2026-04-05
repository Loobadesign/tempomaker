import { useState } from 'react'
import Header from './components/Header'
import GenreSelector from './components/GenreSelector'
import TempoSelector from './components/TempoSelector'
import PlaylistView from './components/PlaylistView'
import { generatePlaylistByTempo } from './utils/spotify'

function App() {
  const [selectedGenres, setSelectedGenres] = useState([])
  const [selectedTempo, setSelectedTempo] = useState(null)
  const [playlist, setPlaylist] = useState([])
  const [loading, setLoading] = useState(false)
  const [loadingProgress, setLoadingProgress] = useState(0)
  const [error, setError] = useState(null)
  const [view, setView] = useState('select') // 'select' | 'playlist'

  const handleGenreToggle = (genre) => {
    setSelectedGenres((prev) => {
      const exists = prev.some((g) => g.id === genre.id)
      if (exists) return prev.filter((g) => g.id !== genre.id)
      return [...prev, genre]
    })
  }

  const handleTempoSelect = async (tempoKey) => {
    if (selectedGenres.length === 0) {
      setError('Sélectionne au moins un genre de musique !')
      return
    }

    setSelectedTempo(tempoKey)
    setLoading(true)
    setLoadingProgress(0)
    setError(null)

    try {
      const tracks = await generatePlaylistByTempo(tempoKey, selectedGenres, (found) => {
        setLoadingProgress(found)
      })
      setPlaylist(tracks)
      setView('playlist')
    } catch (err) {
      console.error('Error generating playlist:', err)
      setError('Erreur lors de la génération. Réessaie !')
    } finally {
      setLoading(false)
    }
  }

  const handleBack = () => {
    setView('select')
    setPlaylist([])
    setSelectedTempo(null)
  }

  return (
    <div className="min-h-screen flex flex-col">
      <Header />

      <main className="flex-1">
        {view === 'select' && (
          <>
            {/* Hero */}
            <div className="text-center pt-16 pb-4 px-6">
              <div className="mb-6 flex justify-center">
                <div
                  className="w-16 h-16 bg-brand-yellow rounded-2xl flex items-center justify-center shadow-lg shadow-brand-yellow/20"
                  style={{ animation: 'pulse-glow 3s ease-in-out infinite' }}
                >
                  <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#0A0A0A" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M9 18V5l12-2v13" />
                    <circle cx="6" cy="18" r="3" />
                    <circle cx="18" cy="16" r="3" />
                  </svg>
                </div>
              </div>
              <h1 className="text-4xl sm:text-5xl font-black tracking-tight mb-3">
                Tempo<span className="text-brand-yellow">Maker</span>
              </h1>
              <p className="text-brand-gray text-lg max-w-md mx-auto">
                Choisis tes styles, ton rythme, et on génère ta playlist.
              </p>
            </div>

            {/* Step 1: Genre */}
            <GenreSelector
              selected={selectedGenres}
              onToggle={handleGenreToggle}
            />

            {/* Step 2: Tempo */}
            {selectedGenres.length > 0 && (
              <TempoSelector
                onSelect={handleTempoSelect}
                loading={loading}
                selectedTempo={selectedTempo}
                loadingProgress={loadingProgress}
              />
            )}

            {error && (
              <div className="max-w-4xl mx-auto px-6 pb-8">
                <div className="bg-red-500/10 border border-red-500/30 text-red-400 rounded-xl px-4 py-3 text-sm text-center">
                  {error}
                </div>
              </div>
            )}
          </>
        )}

        {view === 'playlist' && (
          <PlaylistView
            tracks={playlist}
            tempoKey={selectedTempo}
            selectedGenres={selectedGenres}
            genreLabels={selectedGenres.map((g) => g.label).join(', ')}
            onBack={handleBack}
            onTracksUpdate={setPlaylist}
          />
        )}
      </main>

      <footer className="text-center py-6 text-xs text-brand-gray border-t border-brand-dark-3">
        TempoMaker &mdash; Propulsé par Deezer API
      </footer>
    </div>
  )
}

export default App
