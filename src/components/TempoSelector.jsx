import { TEMPO_RANGES } from '../utils/spotify'

const tempoCards = [
  {
    key: 'slow',
    gradient: 'from-blue-500/10 to-purple-500/10',
    borderHover: 'hover:border-blue-500/40',
    iconBg: 'bg-blue-500/20',
    bpmColor: 'text-blue-400',
  },
  {
    key: 'moderate',
    gradient: 'from-green-500/10 to-emerald-500/10',
    borderHover: 'hover:border-green-500/40',
    iconBg: 'bg-green-500/20',
    bpmColor: 'text-green-400',
  },
  {
    key: 'fast',
    gradient: 'from-orange-500/10 to-amber-500/10',
    borderHover: 'hover:border-orange-500/40',
    iconBg: 'bg-orange-500/20',
    bpmColor: 'text-orange-400',
  },
  {
    key: 'ultrafast',
    gradient: 'from-red-500/10 to-pink-500/10',
    borderHover: 'hover:border-red-500/40',
    iconBg: 'bg-red-500/20',
    bpmColor: 'text-red-400',
  },
]

export default function TempoSelector({ onSelect, loading, selectedTempo }) {
  return (
    <div className="max-w-4xl mx-auto px-6 py-12">
      <div className="text-center mb-10">
        <h2 className="text-3xl font-bold mb-3">
          Choisis ton <span className="text-brand-yellow">tempo</span>
        </h2>
        <p className="text-brand-gray">
          Sélectionne une vitesse et on génère ta playlist personnalisée
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {tempoCards.map((card) => {
          const range = TEMPO_RANGES[card.key]
          const isSelected = selectedTempo === card.key
          const isLoading = loading && isSelected

          return (
            <button
              key={card.key}
              onClick={() => onSelect(card.key)}
              disabled={loading}
              className={`
                relative group bg-gradient-to-br ${card.gradient}
                rounded-2xl p-6 border transition-all duration-300
                text-left w-full
                ${isSelected
                  ? 'border-brand-yellow shadow-lg shadow-brand-yellow/10 scale-[1.02]'
                  : `border-brand-dark-3 ${card.borderHover}`
                }
                ${loading && !isSelected ? 'opacity-50 cursor-not-allowed' : 'hover:scale-[1.02] active:scale-[0.98]'}
              `}
            >
              {isLoading && (
                <div className="absolute inset-0 rounded-2xl bg-brand-black/50 flex items-center justify-center z-10">
                  <div className="w-8 h-8 border-2 border-brand-yellow border-t-transparent rounded-full animate-spin" />
                </div>
              )}

              <div className={`w-12 h-12 ${card.iconBg} rounded-xl flex items-center justify-center text-2xl mb-4`}>
                {range.emoji}
              </div>

              <h3 className="text-lg font-bold text-brand-light mb-1">
                {range.label}
              </h3>

              <p className={`text-sm font-mono font-semibold ${card.bpmColor}`}>
                {range.description}
              </p>

              <div className="mt-4 flex items-center gap-1">
                {Array.from({ length: card.key === 'slow' ? 1 : card.key === 'moderate' ? 2 : card.key === 'fast' ? 3 : 4 }).map((_, i) => (
                  <div
                    key={i}
                    className={`h-1.5 rounded-full flex-1 ${
                      isSelected ? 'bg-brand-yellow' : 'bg-brand-dark-3 group-hover:bg-brand-gray/30'
                    } transition-colors`}
                  />
                ))}
                {Array.from({ length: 4 - (card.key === 'slow' ? 1 : card.key === 'moderate' ? 2 : card.key === 'fast' ? 3 : 4) }).map((_, i) => (
                  <div key={`empty-${i}`} className="h-1.5 rounded-full flex-1 bg-brand-dark-3/50" />
                ))}
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}
