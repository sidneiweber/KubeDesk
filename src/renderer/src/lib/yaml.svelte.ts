import type { WatchKind } from '@shared/api'

export interface YamlTarget {
  kind: WatchKind
  namespace: string
  name: string
}

// YAML aberto no visualizador. Qualquer tela abre com openYaml(); o
// visualizador fica no App, por cima de tudo.
class YamlView {
  target = $state<YamlTarget | null>(null)
}

export const yamlView = new YamlView()

export function openYaml(kind: WatchKind, namespace: string, name: string): void {
  yamlView.target = { kind, namespace, name }
}
