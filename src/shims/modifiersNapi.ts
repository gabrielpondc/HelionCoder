type ModifiersNapiModule = {
  prewarm?: () => void
  isModifierPressed?: (modifier: string) => boolean
}

function loadModifiersNapi(): ModifiersNapiModule | null {
  try {
    const dynamicRequire = new Function('return require')() as NodeRequire
    return dynamicRequire('modifiers-napi') as ModifiersNapiModule
  } catch {
    return null
  }
}

export function prewarmModifiersNapi(): void {
  loadModifiersNapi()?.prewarm?.()
}

export function isModifierPressedNapi(modifier: string): boolean {
  return loadModifiersNapi()?.isModifierPressed?.(modifier) ?? false
}
