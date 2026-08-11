<script>
  import { page } from "$app/state";

  let menuOpen = $state(false);

  const items = [
    { label: "INDEX", href: "/", match: (p) => p === "/" },
    {
      label: "WRITING",
      href: "/writing",
      match: (p) => p.startsWith("/writing"),
    },
    { label: "TAGS", href: "/tags", match: (p) => p.startsWith("/tags") },
    { label: "ABOUT", href: "/about", match: (p) => p.startsWith("/about") },
  ];

  const path = $derived(page.url.pathname);
</script>

<header class="site-header">
  <a class="wordmark" href="/">
    <span class="tilde">~/</span>
    <span class="name">0xspryon</span>
  </a>

  <nav class="nav-desktop" aria-label="Primary">
    {#each items as item (item.label)}
      {@const active = item.match(path)}
      {#if item.href}
        <a
          class="nav-item"
          class:active
          href={item.href}
          aria-current={active ? "page" : undefined}>{item.label}</a
        >
      {:else}
        <span class="nav-item nav-item--stub" title="Coming soon"
          >{item.label}</span
        >
      {/if}
    {/each}
  </nav>

  <button
    class="hamburger"
    aria-label="Menu"
    aria-expanded={menuOpen}
    onclick={() => (menuOpen = !menuOpen)}
  >
    <i class="las {menuOpen ? 'la-times' : 'la-bars'}"></i>
  </button>
</header>

{#if menuOpen}
  <nav class="nav-mobile" aria-label="Primary">
    {#each items as item (item.label)}
      {@const active = item.match(path)}
      {#if item.href}
        <a
          class="nav-item"
          class:active
          href={item.href}
          onclick={() => (menuOpen = false)}>{item.label}</a
        >
      {:else}
        <span class="nav-item nav-item--stub">{item.label}</span>
      {/if}
    {/each}
  </nav>
{/if}

<style>
  .site-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 22px var(--frame-pad);
    border-bottom: 1px solid var(--hairline);
  }

  .wordmark {
    display: flex;
    align-items: baseline;
    gap: 9px;
  }
  .tilde {
    font-family: var(--mono);
    font-size: 13px;
    color: var(--meta);
  }
  .name {
    font-family: var(--serif);
    font-style: italic;
    font-weight: 500;
    font-size: 21px;
    color: var(--ink);
  }

  .nav-desktop {
    display: flex;
    align-items: center;
    gap: 38px;
  }
  .nav-item {
    font-family: var(--mono);
    font-size: 11.5px;
    font-weight: 500;
    letter-spacing: 2px;
    color: var(--meta);
    display: inline-flex;
    align-items: center;
    gap: 9px;
    transition: color 0.18s ease;
  }
  a.nav-item:hover {
    color: var(--ink);
  }
  .nav-item.active {
    color: var(--ink);
  }
  .nav-item.active::before {
    content: "";
    width: 7px;
    height: 7px;
    background: var(--ink);
  }
  .nav-item--stub {
    cursor: default;
  }

  .hamburger {
    display: none;
    background: none;
    border: none;
    cursor: pointer;
    color: var(--ink);
    font-size: 26px;
    line-height: 1;
    padding: 2px;
  }

  .nav-mobile {
    display: none;
  }

  @media (max-width: 700px) {
    .site-header {
      padding: 18px var(--frame-pad);
    }
    .name {
      font-size: 17px;
    }
    .nav-desktop {
      display: none;
    }
    .hamburger {
      display: block;
    }
    .nav-mobile {
      display: flex;
      flex-direction: column;
      gap: 20px;
      padding: 24px var(--frame-pad);
      border-bottom: 1px solid var(--hairline);
    }
  }
</style>
