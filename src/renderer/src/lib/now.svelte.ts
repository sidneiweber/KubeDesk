// Relógio compartilhado para as colunas de idade: um timer para o app
// inteiro, em vez de um por tabela.

class Now {
  value = $state(Date.now())

  constructor() {
    setInterval(() => (this.value = Date.now()), 1000)
  }
}

export const now = new Now()
