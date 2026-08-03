<script>
  import { onMount } from "svelte";

  // The frosted-glass intro. Real page content renders behind this overlay;
  // `backdrop-filter` frosts it, then the frost clears + the panel lifts away.
  let progress = $state(0); // 0 → 100
  let done = $state(false); // triggers the lift-away transition
  let hidden = $state(false); // fully removed from the layout

  // Blur eases from heavy → 0 as the counter climbs. Squared falloff so most
  // of the "coming into focus" happens near the end — reads as a snap to sharp.
  let blur = $derived(22 * Math.pow(1 - progress / 100, 2));
  let padded = $derived(String(Math.round(progress)).padStart(3, "0"));

  onMount(() => {
    const reduce =
      typeof matchMedia !== "undefined" &&
      matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (reduce) {
      // Skip the show; just clear immediately.
      progress = 100;
      finish();
      return;
    }

    const DURATION = 1900; // ms of frost-clearing
    let start;
    let raf;

    const tick = (t) => {
      if (start === undefined) start = t;
      const p = Math.min((t - start) / DURATION, 1);
      // easeOutCubic — fast then settling
      progress = (1 - Math.pow(1 - p, 3)) * 100;
      if (p < 1) {
        raf = requestAnimationFrame(tick);
      } else {
        finish();
      }
    };
    raf = requestAnimationFrame(tick);

    // Failsafe: rAF is paused while the tab/pane is hidden, so the clock only
    // runs once the page is actually on screen — the frost holds until seen.
    // This guarantees the overlay can never trap content behind glass even if
    // rAF misbehaves.
    const failsafe = setTimeout(() => {
      if (!hidden) {
        progress = 100;
        finish();
      }
    }, DURATION + 6000);

    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(failsafe);
    };
  });

  function finish() {
    done = true; // lift the panel
    setTimeout(() => (hidden = true), 900); // remove after the transition
  }
</script>

{#if !hidden}
  <div class="loader" class:done style="--blur:{blur}px" aria-hidden="true">
    <div class="glass"></div>
    <div class="content">
      <span class="mark"
        >Notes on breaking <em>&amp; mending</em> software.</span
      >
      <div class="bar">
        <span class="fill" style="width:{progress}%"></span>
      </div>
      <span class="counter">{padded}<span class="pct">%</span></span>
    </div>
  </div>
{/if}

<style>
  .loader {
    position: fixed;
    inset: 0;
    z-index: 1000;
    display: grid;
    place-items: center;
    /* The lift-away: translate up + fade, revealing the sharp page beneath. */
    transition:
      transform 0.9s cubic-bezier(0.76, 0, 0.24, 1),
      opacity 0.9s cubic-bezier(0.76, 0, 0.24, 1);
  }
  .loader.done {
    transform: translateY(-101%);
    opacity: 0;
    pointer-events: none;
  }

  /* The frosted pane — translucent paper tint + backdrop blur over content. */
  .glass {
    position: absolute;
    inset: 0;
    background: rgba(248, 247, 242, 0.55);
    -webkit-backdrop-filter: blur(var(--blur)) saturate(1.4);
    backdrop-filter: blur(var(--blur)) saturate(1.4);
    /* Hairline seam along the bottom edge as the pane lifts. */
    border-bottom: 1px solid var(--hairline);
  }

  .content {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 22px;
  }

  /* Matches the landing-page hero headline: serif, italic accent, ink. */
  .mark {
    font-family: var(--serif);
    font-size: 30px;
    font-weight: 400;
    letter-spacing: -0.5px;
    line-height: 1.14;
    color: var(--ink);
    text-align: center;
    /* max-width: 340px; */
  }
  .mark em {
    font-style: italic;
  }

  .bar {
    width: 220px;
    height: 1px;
    background: var(--pill-border);
    overflow: hidden;
  }
  .fill {
    display: block;
    height: 100%;
    background: var(--ink);
  }

  .counter {
    font-family: var(--mono);
    font-size: 12px;
    font-weight: 500;
    letter-spacing: 2px;
    color: var(--meta);
  }
  .pct {
    margin-left: 2px;
    color: var(--faint);
  }

  @media (max-width: 700px) {
    .bar {
      width: 160px;
    }
    .mark {
      font-size: 23px;
      max-width: 260px;
    }
  }
</style>
