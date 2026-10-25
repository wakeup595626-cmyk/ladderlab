import { useEffect, useState } from 'react'

/** Subscribes to a CSS media query so layout decisions stay in sync on resize. */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => (
    typeof window === 'undefined' ? false : window.matchMedia(query).matches
  ))

  useEffect(() => {
    const media = window.matchMedia(query)
    const update = () => setMatches(media.matches)
    update()
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [query])

  return matches
}
