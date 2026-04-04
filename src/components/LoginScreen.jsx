import { redirectToSpotifyAuth } from '../utils/spotify'

export default function LoginScreen() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-6">
      <div className="max-w-lg w-full text-center">
        {/* Logo */}
        <div className="mb-8 flex justify-center">
          <div className="w-20 h-20 bg-brand-yellow rounded-2xl flex items-center justify-center shadow-lg shadow-brand-yellow/20"
               style={{ animation: 'pulse-glow 3s ease-in-out infinite' }}>
            <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="#0A0A0A" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 18V5l12-2v13" />
              <circle cx="6" cy="18" r="3" />
              <circle cx="18" cy="16" r="3" />
            </svg>
          </div>
        </div>

        <h1 className="text-5xl font-black tracking-tight mb-4">
          Tempo<span className="text-brand-yellow">Maker</span>
        </h1>

        <p className="text-brand-gray text-lg mb-2">
          Génère des playlists basées sur le tempo de tes morceaux préférés.
        </p>
        <p className="text-brand-gray-light text-sm mb-10">
          Choisis un rythme. On s'occupe du reste.
        </p>

        {/* Tempo preview cards */}
        <div className="grid grid-cols-4 gap-3 mb-10">
          {[
            { label: 'Lent', bpm: '50–90', icon: '🐢' },
            { label: 'Modéré', bpm: '90–120', icon: '🚶' },
            { label: 'Rapide', bpm: '120–150', icon: '🏃' },
            { label: 'Ultra', bpm: '150+', icon: '⚡' },
          ].map((t) => (
            <div
              key={t.label}
              className="bg-brand-dark-2 rounded-xl p-3 border border-brand-dark-3"
            >
              <div className="text-2xl mb-1">{t.icon}</div>
              <div className="text-xs font-semibold text-brand-light">{t.label}</div>
              <div className="text-[10px] text-brand-gray">{t.bpm}</div>
            </div>
          ))}
        </div>

        {/* Login button */}
        <button
          onClick={redirectToSpotifyAuth}
          className="w-full bg-brand-yellow hover:bg-brand-yellow-dark text-brand-black font-bold py-4 px-8 rounded-xl text-lg transition-all duration-200 hover:scale-[1.02] active:scale-[0.98] shadow-lg shadow-brand-yellow/20"
        >
          <span className="flex items-center justify-center gap-3">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="#0A0A0A">
              <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/>
            </svg>
            Se connecter avec Spotify
          </span>
        </button>

        <p className="text-brand-gray text-xs mt-6">
          Connecte ton compte Spotify pour analyser les BPM de ta musique
          et générer des playlists personnalisées.
        </p>
      </div>
    </div>
  )
}
