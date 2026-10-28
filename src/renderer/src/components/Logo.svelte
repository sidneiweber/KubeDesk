<script lang="ts">
  // Símbolo e wordmark do kit de marca. As cores das faces vêm do kit; em
  // fundo escuro ou navy a face esquerda clareia/escurece para não sumir.

  let { size = 24, wordmark = true, on = 'light' }: {
    /** Largura do cubo em px. */
    size?: number
    wordmark?: boolean
    on?: 'light' | 'dark' | 'navy'
  } = $props()

  const left = $derived(on === 'dark' ? '#123B7A' : on === 'navy' ? '#0A1F45' : '#0B2A5B')
</script>

<span class="logo {on}" style:gap="{Math.round(size * 0.4)}px" role="img" aria-label="Kubedesk">
  <svg width={size} height={Math.round(size * 1.16)} viewBox="0 0 100 116" aria-hidden="true">
    <polygon fill="#1C8FD8" points="50,1 99,29.5 50,58 1,29.5" />
    <polygon fill={left} points="1,29.5 50,58 50,115 1,86.5" />
    <polygon fill="#12A8E6" points="50,58 99,29.5 99,86.5 50,115" />
    <g fill="#0E5AA7" transform="matrix(0.49,-0.285,0,0.57,50,58)">
      <rect x="22" y="14" width="17" height="78" />
      <polygon points="39,50 72,14 94,14 39,72" />
      <polygon points="50,60 62,48 96,92 74,92" />
    </g>
  </svg>
  {#if wordmark}
    <span class="wm" aria-hidden="true" style:font-size="{Math.round(size * 0.8)}px"><span class="a">kube</span><span class="b">desk</span></span>
  {/if}
</span>

<style>
  .logo { display: inline-flex; align-items: center; }
  svg { display: block; flex-shrink: 0; }
  .wm { font-weight: 600; letter-spacing: -.03em; line-height: 1; white-space: nowrap; }
  /* Cores do kit de marca, fixas aqui: o tema do app não as usa */
  .a { color: #0B2A5B; }
  .b { color: #0B6BB5; }
  .dark .a, .navy .a { color: #fff; }
  .dark .b, .navy .b { color: #4FC3F7; }
</style>
