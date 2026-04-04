import { GENRES } from '../utils/genres'

export default function GenreSelector({ selected, onToggle }) {
  return (
    <div className="max-w-4xl mx-auto px-6 pb-6">
      <div className="text-center mb-8">
        <h2 className="text-3xl font-bold mb-3">
          Choisis tes <span className="text-brand-yellow">styles</span>
        </h2>
        <p className="text-brand-gray">
          Sélectionne un ou plusieurs genres de musique
        </p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        {GENRES.map((genre) => {
          const isSelected = selected.some((g) => g.id === genre.id)
          return (
            <button
              key={genre.id}
              onClick={() => onToggle(genre)}
              className={`
                flex items-center gap-3 px-4 py-3 rounded-xl border transition-all duration-200 text-left
                ${isSelected
                  ? 'bg-brand-yellow/10 border-brand-yellow text-brand-yellow'
                  : 'bg-brand-dark-2 border-brand-dark-3 text-brand-light hover:border-brand-gray/40'
                }
              `}
            >
              <span className="text-xl">{genre.emoji}</span>
              <span className="text-sm font-medium truncate">{genre.label}</span>
              {isSelected && (
                <svg className="ml-auto shrink-0" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              )}
            </button>
          )
        })}
      </div>

      {selected.length > 0 && (
        <div className="mt-4 text-center text-sm text-brand-gray">
          {selected.length} genre{selected.length > 1 ? 's' : ''} sélectionné{selected.length > 1 ? 's' : ''}
        </div>
      )}
    </div>
  )
}
