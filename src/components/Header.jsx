export default function Header() {
  return (
    <header className="flex items-center justify-between px-6 py-4 border-b border-brand-dark-3">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 bg-brand-yellow rounded-lg flex items-center justify-center">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#0A0A0A" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 18V5l12-2v13" />
            <circle cx="6" cy="18" r="3" />
            <circle cx="18" cy="16" r="3" />
          </svg>
        </div>
        <span className="text-xl font-bold tracking-tight">
          Tempo<span className="text-brand-yellow">Maker</span>
        </span>
      </div>
    </header>
  )
}
