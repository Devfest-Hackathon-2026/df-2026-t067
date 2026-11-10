type IconName = 'compass' | 'pin' | 'map' | 'book' | 'search' | 'user' | 'arrow' | 'plus' | 'minus' | 'reset' | 'locate' | 'check' | 'chevron' | 'panel'
// 線端・角は常に round。パスも角ばった矩形／三角を避け、丸い雰囲気に揃える（t162u）。
const paths: Record<IconName, string[]> = {
  compass: ['M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17', 'm15.8 8.2-1.7 5.1-5.1 1.7 1.7-5.1 5.1-1.7Z'],
  pin: ['M18.5 10.2c0 4.4-6.5 10.3-6.5 10.3S5.5 14.6 5.5 10.2a6.5 6.5 0 0 1 13 0Z'],
  map: ['M4.5 6.2 9 4.5l6 1.7 4.5-1.5v13.1L15 19.5l-6-1.7-4.5 1.5V6.2Z', 'M9 4.8v12.8M15 6.2v12.8'],
  book: ['M5 5.5h5.2c.9 0 1.8.7 1.8 1.6 0-.9.9-1.6 1.8-1.6H19V19h-5.2c-.9 0-1.8.5-1.8 1.2 0-.7-.9-1.2-1.8-1.2H5V5.5Z', 'M12 7.2v12.2'],
  user: ['M16 7.5a4 4 0 1 1-8 0 4 4 0 0 1 8 0', 'M5 20v-1.2a7 7 0 0 1 14 0V20'],
  arrow: ['M4.5 12h15m-5.5-5.5L20 12l-5.5 5.5'],
  plus: ['M12 5.5v13M5.5 12h13'],
  minus: ['M5.5 12h13'],
  reset: ['M4.2 10.5a8 8 0 1 1 1.3 6.2', 'M4 4.8v5.2h5.2'],
  // 角ばった三角矢印ではなく、丸い照準（現在地）
  locate: ['M12 3.2v2.6M12 18.2v2.6M3.2 12h2.6M18.2 12h2.6', 'M12 8.2a3.8 3.8 0 1 0 0 7.6 3.8 3.8 0 0 0 0-7.6'],
  check: ['M20 7 9.5 17.5 4.5 12.5'],
  chevron: ['m7 9.5 5 5 5-5'],
  search: ['M11 5.2a5.8 5.8 0 1 0 0 11.6 5.8 5.8 0 0 0 0-11.6', 'm20.2 20.2-4-4'],
  // 角丸のパネル枠
  panel: ['M5.5 6.2c0-.9.7-1.6 1.6-1.6h9.8c.9 0 1.6.7 1.6 1.6v11.6c0 .9-.7 1.6-1.6 1.6H7.1c-.9 0-1.6-.7-1.6-1.6V6.2Z', 'M9.5 4.6v14.8'],
}

export function Icon({ name, className = '' }: { name: IconName; className?: string }) {
  return (
    <svg className={'icon ' + className} viewBox="0 0 24 24"
      fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {paths[name].map((d) => <path key={d} d={d} />)}
      {name === 'pin' && <circle cx="12" cy="10.2" r="2.8" fill="#ffffff" stroke="none" />}
    </svg>
  )
}
