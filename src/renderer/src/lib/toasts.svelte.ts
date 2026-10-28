export interface Toast {
  id: number
  kind: 'success' | 'error'
  text: string
}

const DURATION_MS = { success: 4000, error: 8000 }

class Toasts {
  items = $state<Toast[]>([])
  private next = 0

  show(kind: Toast['kind'], text: string): void {
    const id = ++this.next
    this.items.push({ id, kind, text })
    setTimeout(() => this.dismiss(id), DURATION_MS[kind])
  }

  success(text: string): void {
    this.show('success', text)
  }

  error(text: string): void {
    this.show('error', text)
  }

  dismiss(id: number): void {
    this.items = this.items.filter((t) => t.id !== id)
  }
}

export const toasts = new Toasts()
