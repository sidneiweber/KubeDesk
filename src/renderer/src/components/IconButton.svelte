<script lang="ts" module>
  // Bootstrap Icons (MIT), os mesmos do app original. Embutidos no build:
  // o app funciona offline.
  import fileText from 'bootstrap-icons/icons/file-text.svg?raw'
  import fileCode from 'bootstrap-icons/icons/file-code.svg?raw'
  import eye from 'bootstrap-icons/icons/eye.svg?raw'
  import arrowClockwise from 'bootstrap-icons/icons/arrow-clockwise.svg?raw'
  import arrowsFullscreen from 'bootstrap-icons/icons/arrows-fullscreen.svg?raw'
  import box from 'bootstrap-icons/icons/box.svg?raw'

  const ICONS = {
    logs: fileText,
    yaml: fileCode,
    details: eye,
    restart: arrowClockwise,
    scale: arrowsFullscreen,
    pods: box,
  }

  export type IconName = keyof typeof ICONS
</script>

<script lang="ts">
  // Botão só com ícone. `label` vira a dica do mouse e o nome lido por
  // leitores de tela, então diga a ação e o alvo ("Logs de web-1").

  let { icon, label, onclick }: { icon: IconName; label: string; onclick: () => void } = $props()
</script>

<button class="icon-btn" aria-label={label} title={label} {onclick}>
  <!-- SVG estático do pacote, não vem de dado do usuário -->
  {@html ICONS[icon]}
</button>

<style>
  .icon-btn {
    display: inline-flex; align-items: center; justify-content: center;
    width: 28px; height: 26px; padding: 0;
    color: var(--muted);
  }
  .icon-btn:hover:not(:disabled) { color: var(--accent); }
  .icon-btn :global(svg) { width: 14px; height: 14px; flex-shrink: 0; }
</style>
