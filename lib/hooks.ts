import { useState, useEffect } from 'react'

/** Returns `true` after the first render. Use to skip effects that shouldn't fire on mount. */
export function useMounted() {
  const [mounted, setMounted] = useState(false)
  useEffect(() => { setMounted(true) }, [])
  return mounted
}
