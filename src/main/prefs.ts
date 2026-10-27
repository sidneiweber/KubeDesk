import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

// Preferências do usuário num JSON na pasta de dados do app.
//
// O localStorage do renderer não serve: com sandbox, o Chromium grava as
// mudanças em disco com atraso, e um encerramento abrupto (crash, kill) perde
// o que ainda estava em memória. Aqui cada mudança vai para o disco na hora,
// por um arquivo temporário + rename, para nunca deixar um JSON pela metade.

export type Prefs = Record<string, unknown>

export class PrefsStore {
  private data: Prefs

  constructor(private readonly file: string) {
    this.data = this.read()
  }

  static inDir(dir: string): PrefsStore {
    return new PrefsStore(join(dir, 'preferences.json'))
  }

  get(key: string): unknown {
    return this.data[key]
  }

  set(key: string, value: unknown): void {
    if (value === undefined) delete this.data[key]
    else this.data[key] = value
    mkdirSync(dirname(this.file), { recursive: true })
    const tmp = `${this.file}.tmp`
    writeFileSync(tmp, JSON.stringify(this.data, null, 2))
    renameSync(tmp, this.file)
  }

  private read(): Prefs {
    try {
      const parsed: unknown = JSON.parse(readFileSync(this.file, 'utf8'))
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Prefs) : {}
    } catch {
      // Arquivo ausente ou corrompido: começa do zero em vez de travar o app
      return {}
    }
  }
}
