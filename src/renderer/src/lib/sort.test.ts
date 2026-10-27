import { describe, expect, it } from 'vitest'
import { nextSort, readyFraction, sortRows, type Accessors } from './sort'

// Mesmos casos de legacy/test/table-sort.test.js.

interface Row {
  name: string
  restarts?: number
  created?: number
  ready?: string
  node?: string | null
}

const acc: Accessors<Row> = {
  name: (r) => r.name,
  restarts: (r) => r.restarts,
  age: (r) => (r.created ? -r.created : null),
  ready: (r) => readyFraction(r.ready ?? '0/0'),
  node: (r) => r.node,
}

const pods: Row[] = [
  { name: 'zeta', restarts: 2, created: Date.parse('2026-09-01'), ready: '1/1' },
  { name: 'alpha', restarts: 11, created: Date.parse('2026-08-01'), ready: '0/2' },
  { name: 'meio', restarts: 0, created: Date.parse('2026-09-03'), ready: '2/2' },
]
const names = (rows: Row[]) => rows.map((r) => r.name).join(',')

describe('sortRows', () => {
  it('nome asc e desc', () => {
    expect(names(sortRows(pods, acc, { column: 'name', direction: 'asc' }))).toBe('alpha,meio,zeta')
    expect(names(sortRows(pods, acc, { column: 'name', direction: 'desc' }))).toBe('zeta,meio,alpha')
  })

  it('restarts numérico (11 > 2)', () => {
    expect(sortRows(pods, acc, { column: 'restarts', direction: 'desc' }).map((p) => p.restarts)).toEqual([11, 2, 0])
  })

  it('idade asc = mais novo primeiro, pelo timestamp', () => {
    expect(names(sortRows(pods, acc, { column: 'age', direction: 'asc' }))).toBe('meio,zeta,alpha')
  })

  it('ready ordena pela fração', () => {
    expect(sortRows(pods, acc, { column: 'ready', direction: 'asc' }).map((p) => p.ready)).toEqual(['0/2', '1/1', '2/2'])
  })

  it('sem estado ou coluna desconhecida preserva a ordem', () => {
    expect(names(sortRows(pods, acc, null))).toBe('zeta,alpha,meio')
    expect(names(sortRows(pods, acc, { column: 'inexistente', direction: 'asc' }))).toBe('zeta,alpha,meio')
  })

  it('não muta a lista original', () => {
    const before = [...pods]
    sortRows(pods, acc, { column: 'name', direction: 'asc' })
    expect(pods).toEqual(before)
  })

  it('nulos vão para o fim nas duas direções', () => {
    const rows: Row[] = [{ name: 'b', node: 'no-2' }, { name: 'a', node: null }, { name: 'c', node: 'no-1' }]
    expect(names(sortRows(rows, acc, { column: 'node', direction: 'asc' }))).toBe('c,b,a')
    expect(names(sortRows(rows, acc, { column: 'node', direction: 'desc' }))).toBe('b,c,a')
  })

  it('ordem natural: pod-2 antes de pod-10', () => {
    const rows: Row[] = [{ name: 'pod-10' }, { name: 'pod-2' }, { name: 'pod-1' }]
    expect(names(sortRows(rows, acc, { column: 'name', direction: 'asc' }))).toBe('pod-1,pod-2,pod-10')
  })
})

describe('nextSort', () => {
  it('asc -> desc -> nenhum, e outra coluna recomeça em asc', () => {
    const asc = nextSort(null, 'name')
    expect(asc).toEqual({ column: 'name', direction: 'asc' })
    const desc = nextSort(asc, 'name')
    expect(desc).toEqual({ column: 'name', direction: 'desc' })
    expect(nextSort(desc, 'name')).toBeNull()
    expect(nextSort(desc, 'age')).toEqual({ column: 'age', direction: 'asc' })
  })
})
