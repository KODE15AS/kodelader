<script lang="ts">
  import { onMount } from "svelte";

  let state: any = null;
  let stopping = false;
  let phoneInput = "";
  let phoneMsg = "";
  let phoneSaved = false;
  const params = new URLSearchParams(location.search);
  const focusSession = params.get("session");

  // Husk siste aktive økt slik at vi kan vise «ferdig»-kortet (med SMS-felt)
  // også når økten avsluttes mens kunden ser på
  let lastActiveId: string | null = focusSession;
  $: if (state?.active) lastActiveId = state.active.id;
  $: finished = !state?.active && lastActiveId
    ? state?.history?.find((h: any) => h.id === lastActiveId) ?? null
    : null;

  // Kall API relativt slik at det fungerer både bak /kodelader og på rot
  const base = location.pathname.includes("/kodelader") ? "/kodelader" : "";

  async function refresh() {
    try {
      const res = await fetch(`${base}/api/state?enhet=proto1`);
      state = await res.json();
    } catch { /* prøver igjen */ }
  }

  async function stop() {
    if (!state?.active || stopping) return;
    stopping = true;
    await fetch(`${base}/api/session/${state.active.id}/stop`, { method: "POST" });
    setTimeout(async () => { await refresh(); stopping = false; }, 1500);
  }

  async function savePhone() {
    const sessionId = state?.active?.id ?? finished?.id;
    if (!sessionId || !phoneInput.trim()) return;
    phoneMsg = "Lagrer …";
    const res = await fetch(`${base}/api/session/${sessionId}/phone`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone: phoneInput })
    });
    if (res.ok) {
      phoneSaved = true;
      phoneMsg = state?.active ? "Du får SMS når ladingen er ferdig ✓" : "Kvittering sendes på SMS ✓";
      refresh();
    } else {
      phoneMsg = (await res.json().catch(() => null))?.error ?? "Noe gikk galt — prøv igjen";
    }
  }

  function kr(ore: number | null): string {
    return ore == null ? "—" : (ore / 100).toFixed(2).replace(".", ",") + " kr";
  }
  function dt(iso: string | null): string {
    return iso ? new Date(iso).toLocaleString("nb-NO", { dateStyle: "short", timeStyle: "short" }) : "—";
  }
  function costNow(a: any): number {
    return Math.min(a.maxAmountOre, Math.round(a.kwh * a.pricePerKwhOre));
  }

  onMount(() => {
    refresh();
    const t = setInterval(refresh, 5000);
    return () => clearInterval(t);
  });
</script>

<div class="topbar">
  <div class="brand">KODE15 <span>· Kodelader</span></div>
  {#if state}
    <span class="badge {state.env === 'SKARP' ? 'live' : 'test'}">{state.env}</span>
  {/if}
</div>

<main class="narrow">
  {#if !state}
    <p class="muted">Henter status …</p>
  {:else}
    <div class="card">
      <h2>
        <span class="lamp {state.online ? 'green' : 'grey'}"></span>
        Lader {state.online ? "tilkoblet" : "frakoblet"}
      </h2>
      {#if focusSession && !state.active && !finished}
        <p class="muted">Betaling mottatt — venter på at ladingen starter …</p>
      {/if}

      {#if state.active}
        <div class="kpi">
          <div class="item">
            <div class="value">{state.active.kwh.toFixed(2).replace(".", ",")}</div>
            <div class="label">kWh ladet</div>
          </div>
          <div class="item">
            <div class="value">{kr(costNow(state.active))}</div>
            <div class="label">kostnad så langt</div>
          </div>
          <div class="item">
            <div class="value">{state.active.powerW != null ? Math.round(state.active.powerW) : "—"}</div>
            <div class="label">effekt (W)</div>
          </div>
        </div>
        <p class="muted">
          Startet {dt(state.active.startedAt)} · maks {kr(state.active.maxAmountOre)} ·
          {(state.active.pricePerKwhOre / 100).toFixed(2).replace(".", ",")} kr/kWh
        </p>
        {#if state.active.phone === "—" && !phoneSaved}
          <label>Få SMS med kvittering når ladingen er ferdig (valgfritt)</label>
          <div style="display:flex;gap:8px">
            <input placeholder="Mobilnummer" inputmode="tel" bind:value={phoneInput} />
            <button class="ghost" on:click={savePhone}>Lagre</button>
          </div>
          <p class="muted">{phoneMsg}</p>
        {:else if phoneMsg}
          <p class="muted">{phoneMsg}</p>
        {/if}
        <button class="big danger" on:click={stop} disabled={stopping}>
          {stopping ? "Avslutter …" : "Avslutt lading"}
        </button>
      {:else if finished}
        <p><strong>Ladeøkten er ferdig</strong> — {finished.kwh.toFixed(2).replace(".", ",")} kWh for {kr(finished.amountOre)}.</p>
        <p class="muted">Flytt bilen om nødvendig slik at andre kan lade.</p>
        {#if finished.phone === "—" && !phoneSaved}
          <label>Få kvitteringen på SMS (valgfritt)</label>
          <div style="display:flex;gap:8px">
            <input placeholder="Mobilnummer" inputmode="tel" bind:value={phoneInput} />
            <button class="ghost" on:click={savePhone}>Send</button>
          </div>
          <p class="muted">{phoneMsg}</p>
        {:else if phoneMsg}
          <p class="muted">{phoneMsg}</p>
        {/if}
        <a class="ghost" href="{base}/kvittering/{finished.id}">Vis kvittering</a>
      {:else}
        <p>Ingen aktiv ladeøkt. Skann QR-koden på laderen for å starte.</p>
      {/if}
    </div>

    <div class="card">
      <h2><span class="num">02</span>Tidligere økter</h2>
      {#if state.history.length === 0}
        <p class="muted">Ingen fullførte økter ennå.</p>
      {:else}
        <table>
          <thead><tr><th>Avsluttet</th><th>Mobil</th><th>kWh</th><th>Beløp</th></tr></thead>
          <tbody>
            {#each state.history as h}
              <tr>
                <td>{dt(h.endedAt)}</td>
                <td>{h.phone}</td>
                <td>{h.kwh.toFixed(2).replace(".", ",")}</td>
                <td>{kr(h.amountOre)}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      {/if}
    </div>

    <p class="muted" style="text-align:center">
      Elbillading hos KODE15 as · betal med Vipps eller kort · du belastes kun for faktisk ladet energi
    </p>
  {/if}
</main>
