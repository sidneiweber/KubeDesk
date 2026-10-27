// Transforma pedaços de stream em linhas inteiras e as entrega em lotes.
//
// O app antigo repassava cada pedaço como veio do stream, cortado em qualquer
// ponto (até no meio de uma linha ou de um caractere UTF-8). Aqui o renderer
// só recebe linhas inteiras, e o número de eventos tem teto: um lote a cada
// `every` ms com pod quieto, ou um a cada `max` linhas com pod barulhento.
// Contra o minikube, um pod gerando ~45 mil linhas/s deu 45 eventos/s.

export class LineBatcher {
  private decoder = new TextDecoder()
  private partial = ''
  private pending: string[] = []
  private timer: ReturnType<typeof setTimeout> | undefined

  constructor(
    private readonly emit: (lines: string[]) => void,
    private readonly every = 50,
    private readonly max = 1000,
  ) {}

  /** Aceita pedaços quebrados em qualquer ponto, inclusive no meio de um caractere UTF-8. */
  write(chunk: Uint8Array | string): void {
    const text = typeof chunk === 'string' ? chunk : this.decoder.decode(chunk, { stream: true })
    const parts = (this.partial + text).split('\n')
    this.partial = parts.pop() ?? ''

    for (const line of parts) {
      this.pending.push(line.endsWith('\r') ? line.slice(0, -1) : line)
      if (this.pending.length >= this.max) this.flush()
    }
    if (this.pending.length > 0 && !this.timer) {
      this.timer = setTimeout(() => this.flush(), this.every)
    }
  }

  /** Fim do stream: entrega também a última linha sem "\n". */
  end(): void {
    const rest = this.partial + this.decoder.decode()
    this.partial = ''
    if (rest) this.pending.push(rest)
    this.flush()
  }

  /** Descarta o que estiver pendente sem entregar. */
  dispose(): void {
    clearTimeout(this.timer)
    this.timer = undefined
    this.pending = []
    this.partial = ''
  }

  private flush(): void {
    clearTimeout(this.timer)
    this.timer = undefined
    if (this.pending.length === 0) return
    const batch = this.pending
    this.pending = []
    this.emit(batch)
  }
}
