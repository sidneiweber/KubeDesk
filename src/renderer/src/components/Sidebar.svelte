<script lang="ts" module>
  export type Section = 'pods' | 'deployments' | 'namespaces' | 'services' | 'ingresses' | 'endpoints'
</script>

<script lang="ts">
  import { session } from '../lib/session.svelte'
  import logo from '../assets/logo.png'

  let { section = $bindable() }: { section: Section } = $props()

  // `ready: false` = tela ainda não migrada do app antigo
  const groups: { title: string; items: { id: Section; label: string; ready: boolean }[] }[] = [
    {
      title: 'Workload',
      items: [
        { id: 'pods', label: 'Pods', ready: true },
        { id: 'deployments', label: 'Deployments', ready: false },
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
  <header>
    <div class="logo"><img src={logo} alt="" /><h2>KubeDesk</h2></div>
    <div class="status"><span class="dot"></span><span class="ctx" title={session.context}>{session.context}</span></div>
    <button class="switch" onclick={() => session.disconnect()}>Trocar cluster</button>
  </header>

  <label class="ns">
    <span>Namespace</span>
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
      <h3>{g.title}</h3>
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
    width: 240px; flex-shrink: 0;
    display: flex; flex-direction: column; gap: 16px;
    background: var(--surface); border-right: 1px solid var(--border);
    padding: 18px 14px;
  }
  header { display: flex; flex-direction: column; gap: 10px; padding-bottom: 16px; border-bottom: 1px solid var(--border); }
  .logo { display: flex; align-items: center; gap: 10px; }
  .logo img { width: 28px; filter: drop-shadow(0 2px 4px rgba(74, 158, 255, .3)); }
  h2 { color: var(--accent); font-size: 19px; font-weight: 600; }

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
  nav button:hover:not(:disabled) { background: var(--surface-2); }
  nav button.active { background: rgba(74, 158, 255, .15); color: var(--accent); }
  nav button:disabled { color: var(--muted); cursor: default; }
  nav button:focus-visible { outline: 2px solid var(--accent); }
  .soon { font-size: 10px; color: var(--muted); border: 1px solid var(--border); border-radius: 8px; padding: 0 6px; }
</style>
