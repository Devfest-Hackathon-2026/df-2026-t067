type IconName = 'compass' | 'pin' | 'map' | 'book' | 'user' | 'arrow' | 'plus' | 'minus' | 'reset'
const paths: Record<IconName, string[]> = {
  compass: ['M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20', 'm16 8-2 6-6 2 2-6 6-2Z'],
  pin: ['M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 0 1 14 0Z', 'M14 10a2 2 0 1 1-4 0 2 2 0 0 1 4 0'],
  map: ['m3 5 6-2 6 2 6-2v16l-6 2-6-2-6 2V5Z', 'M9 3v16M15 5v16'],
  book: ['M4 4h6c1 0 2 1 2 2 0-1 1-2 2-2h6v15h-6c-1 0-2 1-2 2 0-1-1-2-2-2H4V4Z', 'M12 6v15'],
  user: ['M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0', 'M4 21v-2a8 8 0 0 1 16 0v2'],
  arrow: ['M4 12h16m-6-6 6 6-6 6'],
  plus: ['M12 5v14M5 12h14'],
  minus: ['M5 12h14'],
  reset: ['M3 10a9 9 0 1 1 1 7', 'M3 4v6h6'],
}

export function Icon({ name, className = '' }: { name: IconName; className?: string }) {
  return (
    <svg className={'icon ' + className} width="24" height="24" viewBox="0 0 24 24"
      fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {paths[name].map((d) => <path key={d} d={d} />)}
    </svg>
  )
}
