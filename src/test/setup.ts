import '@testing-library/jest-dom/vitest'

class MemoryStorage implements Storage {
  private values = new Map<string, string>()
  get length() { return this.values.size }
  clear() { this.values.clear() }
  getItem(key: string) { return this.values.get(key) ?? null }
  key(index: number) { return [...this.values.keys()][index] ?? null }
  removeItem(key: string) { this.values.delete(key) }
  setItem(key: string, value: string) { this.values.set(key, String(value)) }
}

const localStorageMock = new MemoryStorage()
Object.defineProperty(window, 'localStorage', { configurable: true, value: localStorageMock })
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: localStorageMock })

class ResizeObserverMock implements ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

Object.defineProperty(globalThis, 'ResizeObserver', {
  configurable: true,
  value: ResizeObserverMock,
})

Object.defineProperty(window, 'matchMedia', {
  configurable: true,
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }),
})

Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
  configurable: true,
  value: () => {},
})

if (!globalThis.requestAnimationFrame) {
  globalThis.requestAnimationFrame = (callback) => window.setTimeout(callback, 0)
  globalThis.cancelAnimationFrame = (handle) => window.clearTimeout(handle)
}
