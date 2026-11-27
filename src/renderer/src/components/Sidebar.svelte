<script lang="ts">
  import { session } from '../lib/session.svelte'
  import { LiveList } from '../lib/liveList.svelte'
  import { nav, type Section } from '../lib/nav.svelte'
  import Logo from './Logo.svelte'
  // Bootstrap Icons, como os do IconButton
  import boxes from 'bootstrap-icons/icons/boxes.svg?raw'
  import diagram from 'bootstrap-icons/icons/diagram-3.svg?raw'
  import sliders from 'bootstrap-icons/icons/sliders.svg?raw'
  import hdd from 'bootstrap-icons/icons/hdd-stack.svg?raw'
  import speedometer from 'bootstrap-icons/icons/speedometer2.svg?raw'
  import chevron from 'bootstrap-icons/icons/chevron-down.svg?raw'

  // Lista ao vivo: um namespace criado depois da conexão aparece sozinho.
  // Até o primeiro lote, vale a lista que veio na conexão.
  const live = new LiveList('namespaces', () => ({ namespace: '' }))
  const listed = $derived(live.loading || live.error ? session.namespaces : live.rows.map((n) => n.name).sort())
  // Sem permissão para listar: campo de texto em vez de seletor
  const canList = $derived(listed.length > 0)
  // O namespace atual continua na lista mesmo se for apagado, para o seletor não ficar em branco
  const names = $derived(session.namespace && !listed.includes(session.namespace) ? [...listed, session.namespace] : listed)

  const groups: { title: string; icon: string; items: { id: Section; label: string }[] }[] = [
    {
      title: 'Workloads',
      icon: boxes,
      items: [
        { id: 'pods', label: 'Pods' },
        { id: 'deployments', label: 'Deployments' },
        { id: 'daemonsets', label: 'DaemonSets' },
        { id: 'statefulsets', label: 'StatefulSets' },
        { id: 'replicasets', label: 'ReplicaSets' },
        { id: 'jobs', label: 'Jobs' },
        { id: 'cronjobs', label: 'CronJobs' },
        { id: 'namespaces', label: 'Namespaces' },
      ],
    },
    {
      title: 'Networking',
      icon: diagram,
      items: [
        { id: 'services', label: 'Services' },
        { id: 'ingresses', label: 'Ingresses' },
        { id: 'endpoints', label: 'Endpoints' },
      ],
    },
    {
      title: 'Configuration',
      icon: sliders,
      items: [
        { id: 'configmaps', label: 'ConfigMaps' },
        { id: 'secrets', label: 'Secrets' },
        { id: 'hpas', label: 'HPA' },
      ],
    },
    {
      title: 'Storage',
      icon: hdd,
      items: [
        { id: 'pvcs', label: 'PersistentVolumeClaims' },
        { id: 'pvs', label: 'PersistentVolumes' },
        { id: 'storageclasses', label: 'StorageClasses' },
        { id: 'volumeattachments', label: 'VolumeAttachments' },
        { id: 'csidrivers', label: 'CSIDrivers' },
        { id: 'csinodes', label: 'CSINodes' },
      ],
    },
  ]

  // Grupos abertos, lembrados entre sessões. Sem preferência salva, todos
  // começam recolhidos.
  const PREF = 'sidebar.expanded'
  let expanded = $state<string[]>([])
  void window.kube.getPref(PREF).then((v) => {
    if (Array.isArray(v)) expanded = v.filter((x): x is string => typeof x === 'string')
  })
  function toggle(title: string) {
    expanded = expanded.includes(title) ? expanded.filter((t) => t !== title) : [...expanded, title]
    // Cópia simples: o IPC não clona o proxy do $state
    void window.kube.setPref(PREF, $state.snapshot(expanded))
  }
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
    <button class="overview" class:active={nav.section === 'overview'}
            aria-current={nav.section === 'overview' ? 'page' : undefined}
            onclick={() => nav.go('overview')}>
      <span class="icon" aria-hidden="true">{@html speedometer}</span>
      <span class="title">Overview</span>
    </button>
    {#each groups as g (g.title)}
      {@const open = expanded.includes(g.title)}
      {@const current = g.items.some((i) => i.id === nav.section)}
      <div class="group">
        <!-- Recolhido com a seção aberta dentro: o título fica destacado -->
        <button class="group-head" class:current={current && !open} aria-expanded={open}
                aria-controls="nav-{g.title}" onclick={() => toggle(g.title)}>
          <span class="icon" aria-hidden="true">{@html g.icon}</span>
          <span class="title">{g.title}</span>
          <span class="chevron" class:closed={!open} aria-hidden="true">{@html chevron}</span>
        </button>
        {#if open}
          <ul id="nav-{g.title}">
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
        {/if}
      </div>
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
  nav { display: flex; flex-direction: column; gap: 6px; }
  .group { display: flex; flex-direction: column; gap: 2px; }
  nav .group-head {
    gap: 8px; justify-content: flex-start; padding: 6px 8px;
    font-size: 11px; text-transform: uppercase; letter-spacing: .06em; color: var(--muted); font-weight: 600;
  }
  nav .overview { justify-content: flex-start; gap: 8px; padding: 7px 8px; font-weight: 600; }
  nav .group-head:hover { color: var(--text); }
  nav .group-head.current { color: var(--accent); }
  .icon, .chevron { display: inline-flex; flex-shrink: 0; }
  .icon :global(svg) { width: 14px; height: 14px; }
  .title { flex: 1; }
  .chevron :global(svg) { width: 10px; height: 10px; transition: transform .15s; }
  .chevron.closed :global(svg) { transform: rotate(-90deg); }
  ul { list-style: none; display: flex; flex-direction: column; gap: 2px; }
  /* Itens alinhados com o texto do título, depois do ícone */
  nav ul button { padding-left: 30px; }
  nav button {
    all: unset; box-sizing: border-box; width: 100%;
    display: flex; align-items: center; justify-content: space-between;
    padding: 7px 10px; border-radius: 6px; cursor: pointer;
  }
  nav button:hover { background: var(--surface-2); }
  nav button.active { background: rgba(74, 158, 255, .15); color: var(--accent); }
  nav button:focus-visible { outline: 2px solid var(--focus); }
</style>
