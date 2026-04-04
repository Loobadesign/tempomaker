export default function ShortcutSetup({ onClose, onDone }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm px-4">
      <div
        className="bg-brand-dark-2 border border-brand-dark-3 rounded-2xl max-w-lg w-full p-6 relative"
        style={{ animation: 'slide-up 0.3s ease-out' }}
      >
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-brand-gray hover:text-brand-light"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>

        <div className="text-center mb-6">
          <div className="w-14 h-14 bg-brand-yellow/10 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <span className="text-3xl">🔧</span>
          </div>
          <h3 className="text-xl font-bold mb-1">Configuration rapide</h3>
          <p className="text-sm text-brand-gray">
            Crée un Raccourci Apple pour importer tes playlists en un clic.
            <br />
            <span className="text-brand-yellow">À faire une seule fois !</span>
          </p>
        </div>

        <div className="space-y-4 text-sm">
          <div className="flex gap-3">
            <div className="w-7 h-7 rounded-lg bg-brand-yellow text-brand-black flex items-center justify-center font-bold text-xs shrink-0">
              1
            </div>
            <div>
              <p className="text-brand-light font-medium">Ouvre l'app Raccourcis (Shortcuts)</p>
              <p className="text-brand-gray text-xs">Sur Mac ou iPhone/iPad</p>
            </div>
          </div>

          <div className="flex gap-3">
            <div className="w-7 h-7 rounded-lg bg-brand-yellow text-brand-black flex items-center justify-center font-bold text-xs shrink-0">
              2
            </div>
            <div>
              <p className="text-brand-light font-medium">Crée un nouveau raccourci nommé <code className="bg-brand-dark-3 px-1.5 py-0.5 rounded text-brand-yellow text-xs">TempoMaker</code></p>
            </div>
          </div>

          <div className="flex gap-3">
            <div className="w-7 h-7 rounded-lg bg-brand-yellow text-brand-black flex items-center justify-center font-bold text-xs shrink-0">
              3
            </div>
            <div>
              <p className="text-brand-light font-medium">Ajoute ces actions dans l'ordre :</p>
              <div className="mt-2 bg-brand-black rounded-xl p-3 space-y-2 text-xs font-mono">
                <p className="text-brand-gray-light">
                  <span className="text-blue-400">Recevoir</span> l'entrée du Raccourci
                </p>
                <p className="text-brand-gray-light">
                  <span className="text-blue-400">Obtenir le dictionnaire</span> depuis l'entrée
                </p>
                <p className="text-brand-gray-light">
                  <span className="text-blue-400">Obtenir la valeur</span> pour la clé <span className="text-brand-yellow">name</span> → variable <span className="text-green-400">Nom</span>
                </p>
                <p className="text-brand-gray-light">
                  <span className="text-blue-400">Obtenir la valeur</span> pour la clé <span className="text-brand-yellow">tracks</span> → variable <span className="text-green-400">Morceaux</span>
                </p>
                <p className="text-brand-gray-light">
                  <span className="text-blue-400">Créer une playlist</span> avec le nom <span className="text-green-400">Nom</span>
                </p>
                <p className="text-brand-gray-light">
                  <span className="text-blue-400">Répéter</span> pour chaque élément dans <span className="text-green-400">Morceaux</span> :
                </p>
                <p className="text-brand-gray-light pl-4">
                  <span className="text-blue-400">Chercher dans Apple Music</span> → élément actuel
                </p>
                <p className="text-brand-gray-light pl-4">
                  <span className="text-blue-400">Ajouter</span> le résultat à la playlist
                </p>
                <p className="text-brand-gray-light">
                  <span className="text-blue-400">Fin de la répétition</span>
                </p>
              </div>
            </div>
          </div>
        </div>

        <button
          onClick={() => {
            localStorage.setItem('tempomaker_shortcut_ready', 'true')
            onDone()
          }}
          className="w-full mt-6 bg-brand-yellow hover:bg-brand-yellow-dark text-brand-black font-bold py-3 rounded-xl transition-all"
        >
          C'est fait !
        </button>
      </div>
    </div>
  )
}
