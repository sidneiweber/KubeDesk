<script lang="ts">
  import { session } from '../lib/session.svelte'
  import { LiveList } from '../lib/liveList.svelte'
  import { nav, type Section } from '../lib/nav.svelte'
  import Logo from './Logo.svelte'

  // Lista ao vivo: um namespace criado depois da conexão aparece sozinho.
  // Até o primeiro lote, vale a lista que veio na conexão.
  const live = new LiveList('namespaces', () => ({ namespace: '' }))
  const listed = $derived(live.loading || live.error ? session.namespaces : live.rows.map((n) => n.name).sort())
  // Sem permissão para listar: campo de texto em vez de seletor
  const canList = $derived(listed.length > 0)
  // O namespace atual continua na lista mesmo se for apagado, para o seletor não ficar em branco
  const names = $derived(session.namespace && !listed.includes(session.namespace) ? [...listed, session.namespace] : listed)

  const groups: { title: string; items: { id: Section; label: string }[] }[] = [
    {
      title: 'Workloads',
      items: [
        { id: 'pods', label: 'Pods' },
        { id: 'deployments', label: 'Deployments' },
        { id: 'namespaces', label: 'Namespaces' },
      ],
    },
    {
      title: 'Networking',
      items: [
        { id: 'services', label: 'Services' },
        { id: 'ingresses', label: 'Ingresses' },
        { id: 'endpoints', label: 'Endpoints' },
      ],
    },
  ]
</script>

<aside>
  <header>
    <Logo size={26} on="dark" />
    <div class="status" title={session.context}><span class="dot" aria-hidden="true"></span><span class="ctx">{session.context}</span></div>
    <button class="switch" onclick={() => session.disconnect()}>Trocar cluster</button>
  </header>

  <label class="ns">
    <span>Namespace</span>
    {#if canList}
      <select bind:value={session.namespace}>
        <option value="">Todos</option>
        {#each names as ns (ns)}
          <option value={ns}>{ns}</option>
        {/each}
      </select>
    {:else}
      <!-- Sem permissão para listar namespaces: digitar o nome -->
      <input value={session.namespace} placeholder="default"
             onchange={(e) => (session.namespace = e.currentTarget.value.trim())} />
    {/if}
  </label>

  <nav aria-label="Seções">
    {#each groups as g (g.title)}
      <h3>{g.title}</h3>
      <ul>
        {#each g.items as item (item.id)}
          <li>
            <button class:active={nav.section === item.id}
                    aria-current={nav.section === item.id ? 'page' : undefined}
                    onclick={() => nav.go(item.id)}>
              {item.label}
            </button>
          </li>
        {/each}
      </ul>
    {/each}
  </nav>
</aside>

<style>
  aside {
    width: 240px; flex-shrink: 0; overflow-y: auto;
    display: flex; flex-direction: column; gap: 16px;
    background: var(--surface); border-right: 1px solid var(--border);
    padding: 18px 14px;
  }
  header { display: flex; flex-direction: column; gap: 10px; padding-bottom: 16px; border-bottom: 1px solid var(--border); }
  .status { display: flex; align-items: center; gap: 8px; min-width: 0; }
  .dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; background: var(--ok); box-shadow: 0 0 8px rgba(74, 222, 128, .5); }
  .ctx { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .switch { font-size: 12px; padding: 4px 8px; align-self: flex-start; }
  .ns { flex-direction: column; align-items: stretch; gap: 6px; font-size: 12px; }
  h3 { font-size: 11px; text-transform: uppercase; letter-spacing: .06em; color: var(--muted); font-weight: 600; margin: 10px 0 6px 8px; }
  ul { list-style: none; display: flex; flex-direction: column; gap: 2px; }
  nav button {
    all: unset; box-sizing: border-box; width: 100%;
    display: flex; align-items: center; justify-content: space-between;
    padding: 7px 10px; border-radius: 6px; cursor: pointer;
  }
  nav button:hover { background: var(--surface-2); }
  nav button.active { background: rgba(74, 158, 255, .15); color: var(--accent); }
  nav button:focus-visible { outline: 2px solid var(--focus); }
</style>
