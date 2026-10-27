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
  <div class="brand"><Logo size={26} on="navy" /></div>

  <div class="cluster">
    <div class="grp">Cluster</div>
    <div class="ctx" title={session.context}>
      <span class="dot" aria-hidden="true"></span>
      <span class="name">{session.context}</span>
    </div>
    <button class="switch" onclick={() => session.disconnect()}>Trocar cluster</button>
  </div>

  <label class="ns">
    <span class="grp">Namespace</span>
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
      <div class="grp">{g.title}</div>
      <ul>
        {#each g.items as item (item.id)}
          <li>
            <button class:active={nav.section === item.id}
                    aria-current={nav.section === item.id ? 'page' : undefined}
                    onclick={() => (nav.section = item.id)}>
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
    width: 232px; flex-shrink: 0; overflow-y: auto;
    display: flex; flex-direction: column; gap: 18px;
    background: var(--side-bg); color: var(--side-text);
    padding: 20px 14px;
  }
  .brand { padding: 0 8px 4px; }

  /* Rótulo de grupo do kit: Mono 11, maiúsculo */
  .grp { font-family: var(--mono); font-size: 11px; font-weight: 500; letter-spacing: .08em; text-transform: uppercase; color: var(--side-muted); padding: 0 10px 6px; }

  .cluster { display: flex; flex-direction: column; }
  .ctx { display: flex; align-items: center; gap: 8px; min-width: 0; padding: 0 10px; color: #fff; font-family: var(--mono); font-size: 13px; }
  .name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; background: #3FD07F; box-shadow: 0 0 0 3px rgba(63, 208, 127, .2); }

  /* Controles sobre navy */
  aside button.switch, aside select, aside input {
    background: var(--side-hover); border-color: #1E4D8F; color: #fff;
  }
  .switch { align-self: flex-start; margin: 10px 10px 0; height: 28px; font-size: 12px; }
  aside button.switch:hover:not(:disabled) { border-color: var(--ciano-claro); color: #fff; }
  aside select:focus, aside input:focus { border-color: var(--ciano-claro); box-shadow: 0 0 0 3px rgba(79, 195, 247, .2); }
  aside input::placeholder { color: var(--side-muted); }

  .ns { flex-direction: column; align-items: stretch; gap: 0; color: inherit; }
  .ns select, .ns input { margin: 0 10px; width: auto; }

  nav { display: flex; flex-direction: column; gap: 2px; }
  nav .grp { padding-top: 12px; }
  ul { list-style: none; display: flex; flex-direction: column; gap: 2px; }
  nav button {
    all: unset; box-sizing: border-box; width: 100%;
    display: flex; align-items: center; justify-content: space-between;
    padding: 9px 10px; border-radius: 8px; cursor: pointer;
    font-size: 14px; color: var(--side-text);
  }
  nav button:hover { background: var(--side-hover); color: #fff; }
  nav button.active { background: var(--azul); color: #fff; font-weight: 500; }
  nav button:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
</style>
