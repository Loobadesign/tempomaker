import { useState, useEffect } from 'react'
import Header from './components/Header'
import LoginScreen from './components/LoginScreen'
import TempoSelector from './components/TempoSelector'
import PlaylistView from './components/PlaylistView'
import {
  getAccessToken,
  exchangeCode,
  getUserProfile,
  generatePlaylistByTempo,
  logout,
} from './utils/spotify'

function App() {
  const [token, setToken] = useState(null)
  const [user, setUser] = useState(null)
  const [view, setView] = useState('select') // 'select' | 'playlist'
  const [selectedTempo, setSelectedTempo] = useState(null)
  const [playlist, setPlaylist] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  // Handle OAuth callback
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const code = params.get('code')

    if (code) {
      exchangeCode(code)
        .then((data) => {
          if (data.access_token) {
            setToken(data.access_token)
          }
        })
        .catch((err) => {
          console.error('Token exchange failed:', err)
        })
        .finally(() => {
          window.history.replaceState({}, '', '/')
        })
    } else {
      const t = getAccessToken()
      if (t) setToken(t)
    }
  }, [])

  // Fetch user profile
  useEffect(() => {
    if (token) {
      getUserProfile(token)
        .then(setUser)
        .catch(() => {
          logout()
          setToken(null)
        })
    }
  }, [token])

  const handleTempoSelect = async (tempoKey) => {
    setSelectedTempo(tempoKey)
    setLoading(true)
    setError(null)

    try {
      const tracks = await generatePlaylistByTempo(token, tempoKey)
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

  const handleLogout = () => {
    logout()
    setToken(null)
    setUser(null)
    setView('select')
  }

  if (!token) {
    return <LoginScreen />
  }

  return (
    <div className="min-h-screen flex flex-col">
      <Header user={user} onLogout={handleLogout} />

      <main className="flex-1">
        {view === 'select' && (
          <>
            <TempoSelector
              onSelect={handleTempoSelect}
              loading={loading}
              selectedTempo={selectedTempo}
            />
            {error && (
              <div className="max-w-4xl mx-auto px-6">
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
            onBack={handleBack}
          />
        )}
      </main>

      <footer className="text-center py-6 text-xs text-brand-gray border-t border-brand-dark-3">
        TempoMaker &mdash; Propulsé par Spotify API
      </footer>
    </div>
  )
}

export default App
