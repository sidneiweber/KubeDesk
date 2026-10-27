import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { PrefsStore } from './prefs'

const dir = () => mkdtempSync(join(tmpdir(), 'kubedesk-prefs-'))

describe('PrefsStore', () => {
  it('grava na hora e lê de volta numa instância nova', () => {
    const d = dir()
    PrefsStore.inDir(d).set('namespace:minikube', 'kubedesk-test')
    expect(PrefsStore.inDir(d).get('namespace:minikube')).toBe('kubedesk-test')
  })

  it('string vazia é um valor ("todos os namespaces"), undefined apaga', () => {
    const d = dir()
    const p = PrefsStore.inDir(d)
    p.set('a', '')
    p.set('b', 'x')
    p.set('b', undefined)
    expect(JSON.parse(readFileSync(join(d, 'preferences.json'), 'utf8'))).toEqual({ a: '' })
  })

  it('arquivo corrompido não derruba o app', () => {
    const d = dir()
    writeFileSync(join(d, 'preferences.json'), '{ isto não é json')
    const p = PrefsStore.inDir(d)
    expect(p.get('qualquer')).toBeUndefined()
    p.set('ok', 1)
    expect(PrefsStore.inDir(d).get('ok')).toBe(1)
  })
})
