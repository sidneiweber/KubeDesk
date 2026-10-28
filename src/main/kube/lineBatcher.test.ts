import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LineBatcher } from './lineBatcher'

describe('LineBatcher', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('junta linhas que chegam picadas em um lote', () => {
    const batches: string[][] = []
    const b = new LineBatcher((l) => batches.push(l))
    b.write('pri')
    b.write('meira\nsegu')
    b.write('nda\r\nterceira\n')
    expect(batches).toEqual([])

    vi.advanceTimersByTime(50)
    expect(batches).toEqual([['primeira', 'segunda', 'terceira']])
  })

  it('entrega sem esperar o timer quando atinge o máximo', () => {
    const batches: string[][] = []
    const b = new LineBatcher((l) => batches.push(l), 50, 3)
    b.write('a\nb\nc\nd\n')
    expect(batches).toEqual([['a', 'b', 'c']])
    vi.advanceTimersByTime(50)
    expect(batches).toEqual([['a', 'b', 'c'], ['d']])
  })

  it('não quebra caractere UTF-8 dividido entre dois pedaços', () => {
    const batches: string[][] = []
    const b = new LineBatcher((l) => batches.push(l))
    const bytes = new TextEncoder().encode('ação\n')
    b.write(bytes.slice(0, 2)) // corta no meio do "ç"
    b.write(bytes.slice(2))
    b.end()
    expect(batches).toEqual([['ação']])
  })

  it('end entrega a última linha sem quebra', () => {
    const batches: string[][] = []
    const b = new LineBatcher((l) => batches.push(l))
    b.write('a\nsem quebra')
    b.end()
    expect(batches).toEqual([['a', 'sem quebra']])
  })

  it('dispose descarta o pendente', () => {
    const emit = vi.fn()
    const b = new LineBatcher(emit)
    b.write('a\n')
    b.dispose()
    vi.advanceTimersByTime(100)
    expect(emit).not.toHaveBeenCalled()
  })
})
