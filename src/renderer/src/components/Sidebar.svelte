<script lang="ts" module>
  export type Section = 'pods' | 'deployments' | 'namespaces' | 'services' | 'ingresses' | 'endpoints'
</script>

<script lang="ts">
  import { session } from '../lib/session.svelte'
  import Logo from './Logo.svelte'

  let { section = $bindable() }: { section: Section } = $props()

  // `ready: false` = tela ainda não migrada do app antigo
  const groups: { title: string; items: { id: Section; label: string; ready: boolean }[] }[] = [
    {
      title: 'Workloads',
      items: [
        { id: 'pods', label: 'Pods', ready: true },
        { id: 'deployments', label: 'Deployments', ready: true },
        { id: 'namespaces', label: 'Namespaces', ready: false },
      ],
    },
    {
      title: 'Networking',
      items: [
        { id: 'services', label: 'Services', ready: false },
        { id: 'ingresses', label: 'Ingresses', ready: false },
        { id: 'endpoints', label: 'Endpoints', ready: false },
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
    {#if session.namespaces.length > 0}
      <select bind:value={session.namespace}>
        <option value="">Todos</option>
        {#each session.namespaces as ns (ns)}
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
            <button class:active={section === item.id} disabled={!item.ready}
                    aria-current={section === item.id ? 'page' : undefined}
                    onclick={() => (section = item.id)}>
              {item.label}
              {#if !item.ready}<span class="soon">em breve</span>{/if}
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
  nav button:hover:not(:disabled) { background: var(--side-hover); color: #fff; }
  nav button.active { background: var(--azul); color: #fff; font-weight: 500; }
  nav button:disabled { color: #6F86A6; cursor: default; }
  nav button:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
  .soon { font-family: var(--mono); font-size: 10px; color: #6F86A6; border: 1px solid #22477F; border-radius: 999px; padding: 0 7px; }
</style>
