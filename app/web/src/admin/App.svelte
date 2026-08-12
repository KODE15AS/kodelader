<script lang="ts">
  import { onMount } from "svelte";

  let tab = "enheter";
  let overview: any = null;
  let settingsData: any = null;
  let sessions: any[] = [];
  let checks: any[] = [];
  let events: any[] = [];
  let saveMsg = "";
  let keyTestMsg = "";

  async function get(path: string) {
    const res = await fetch(path);
    return res.json();
  }

  async function refresh() {
    overview = await get("/api/overview");
    if (tab === "innstillinger" && !settingsData) settingsData = await get("/api/settings");
    if (tab === "okter") sessions = await get("/api/sessions?limit=100");
    if (tab === "etablering") { checks = await get("/api/checks"); events = await get("/api/events?limit=50"); }
  }

  async function saveSettings() {
    saveMsg = "Lagrer …";
    await fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(settingsData)
    });
    saveMsg = "Lagret ✓";
    setTimeout(() => (saveMsg = ""), 2500);
  }

  async function toggleCheck(c: any) {
    await fetch(`/api/checks/${c.id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: c.status === "green" ? "grey" : "green" })
    });
    checks = await get("/api/checks");
  }

  async function runKeyTest() {
    keyTestMsg = "Tester …";
    const r = await fetch("/api/checks/run-keys", { method: "POST" }).then((r) => r.json());
    keyTestMsg = r.ok ? `Nøkler OK (${r.detail})` : `Feilet: ${r.detail}`;
    checks = await get("/api/checks");
  }

  async function manualSwitch(deviceId: string, on: boolean) {
    await fetch(`/api/devices/${deviceId}/switch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ on })
    });
    setTimeout(refresh, 800);
  }

  async function stopSession(id: string) {
    await fetch(`/api/sessions/${id}/stop`, { method: "POST" });
    setTimeout(refresh, 1200);
  }

  function kr(ore: number | null): string {
    return ore == null ? "—" : (ore / 100).toFixed(2).replace(".", ",") + " kr";
  }
  function dt(iso: string | null): string {
    return iso ? new Date(iso).toLocaleString("nb-NO", { dateStyle: "short", timeStyle: "medium" }) : "—";
  }

  function setTab(t: string) {
    tab = t;
    settingsData = null;
    refresh();
  }

  onMount(() => {
    refresh();
    const t = setInterval(refresh, 5000);
    return () => clearInterval(t);
  });
</script>

<div class="topbar">
  <div class="brand">KODE15 <span>· Kodelader admin</span></div>
  {#if overview}
    <span class="badge {overview.env === 'SKARP' ? 'live' : 'test'}">{overview.env}</span>
  {/if}
</div>

<main>
  <div class="tabs">
    <button class:active={tab === "enheter"} on:click={() => setTab("enheter")}>01 Enheter</button>
    <button class:active={tab === "okter"} on:click={() => setTab("okter")}>02 Økter</button>
    <button class:active={tab === "innstillinger"} on:click={() => setTab("innstillinger")}>03 Innstillinger</button>
    <button class:active={tab === "etablering"} on:click={() => setTab("etablering")}>04 Etablering</button>
  </div>

  {#if tab === "enheter" && overview}
    {#each overview.devices as d}
      <div class="card">
        <h2>
          <span class="lamp {d.online ? 'green' : 'grey'}"></span>{d.name}
          {#if d.activeSession}<span class="badge test">ØKT PÅGÅR</span>{/if}
        </h2>
        <p class="muted">{d.shellyId} · sist sett {dt(d.lastSeen)}</p>
        <div class="kpi">
          <div class="item"><div class="value">{d.status.powerW ?? d.status.power ?? "—"}</div><div class="label">effekt (W)</div></div>
          <div class="item"><div class="value">{d.status.energyWh != null ? (d.status.energyWh / 1000).toFixed(1) : "—"}</div><div class="label">måler (kWh totalt)</div></div>
          <div class="item">
            <div class="value">
              <span class="lamp {d.status.switchOn ? 'green' : 'grey'}"></span>{d.status.switchOn ? "PÅ" : "AV"}
            </div>
            <div class="label">kontaktor</div>
          </div>
        </div>
        <p>
          <button class="ghost" on:click={() => manualSwitch(d.id, true)} disabled={!d.online}>Slå PÅ (test)</button>
          <button class="ghost" on:click={() => manualSwitch(d.id, false)} disabled={!d.online}>Slå AV</button>
        </p>
      </div>
    {/each}
  {/if}

  {#if tab === "okter"}
    <div class="card">
      <h2><span class="num">02</span>Økthistorikk</h2>
      <table>
        <thead><tr><th>Start</th><th>Enhet/QR</th><th>Status</th><th>Mobil</th><th>kWh</th><th>Beløp</th><th>Avsluttet fordi</th><th></th></tr></thead>
        <tbody>
          {#each sessions as s}
            <tr>
              <td>{dt(s.created_at)}</td>
              <td>{s.device_id}/{s.product_id}</td>
              <td>
                <span class="lamp {s.status === 'active' ? 'green' : s.status === 'completed' ? 'grey' : s.status === 'capture_failed' ? 'red' : 'grey'}"></span>{s.status}
              </td>
              <td>{s.phone ?? "—"}</td>
              <td>{s.kwh?.toFixed(2)}</td>
              <td>{kr(s.amount_ore)}</td>
              <td class="muted">{s.end_reason ?? ""}</td>
              <td>{#if s.status === "active"}<button class="danger" on:click={() => stopSession(s.id)}>Stopp</button>{/if}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}

  {#if tab === "innstillinger" && settingsData}
    <div class="card">
      <h2><span class="num">03</span>QR-koder / produkter</h2>
      {#each settingsData.products as p}
        <div style="display:flex;gap:12px;align-items:end;flex-wrap:wrap;margin-bottom:8px">
          <div style="flex:2;min-width:160px"><label>Navn ({p.id})</label><input bind:value={p.label} /></div>
          <div style="flex:1;min-width:110px"><label>Maksbeløp (øre)</label><input type="number" bind:value={p.max_amount_ore} /></div>
          <div style="flex:1;min-width:110px"><label>Pris/kWh (øre)</label><input type="number" bind:value={p.price_per_kwh_ore} /></div>
        </div>
      {/each}
    </div>
    <div class="card">
      <h2>Øktslutt-regler</h2>
      <div style="display:flex;gap:12px;flex-wrap:wrap">
        <div style="flex:1;min-width:140px">
          <label>Ferdig-terskel (W)</label>
          <input type="number" bind:value={settingsData.settings.idle_threshold_w} />
        </div>
        <div style="flex:1;min-width:140px">
          <label>Ferdig-varighet (min)</label>
          <input type="number" bind:value={settingsData.settings.idle_minutes} />
        </div>
        <div style="flex:1;min-width:140px">
          <label>Makstid (timer)</label>
          <input type="number" bind:value={settingsData.settings.max_session_hours} />
        </div>
      </div>
      <p><button on:click={saveSettings}>Lagre innstillinger</button> <span class="muted">{saveMsg}</span></p>
    </div>
  {/if}

  {#if tab === "etablering"}
    <div class="card">
      <h2><span class="num">04</span>Etablering — Vipps/Nexi</h2>
      {#if overview}
        <p class="muted">API: {overview.apiBase} · Base-URL: {overview.baseUrl} · SMS: {overview.sveveConfigured ? "konfigurert" : "ikke konfigurert"}</p>
      {/if}
      <p><button class="ghost" on:click={runKeyTest}>Test API-nøkler nå</button> <span class="muted">{keyTestMsg}</span></p>
      <h3>Sandkasse</h3>
      <table>
        <tbody>
          {#each checks.filter((c) => c.phase === "sandkasse") as c}
            <tr>
              <td style="width:24px"><span class="lamp {c.status}"></span></td>
              <td>{c.label}</td>
              <td class="muted">{c.ts ? dt(c.ts) : ""} {c.note ?? ""}</td>
              <td>{#if c.kind === "manual"}<button class="ghost" on:click={() => toggleCheck(c)}>{c.status === "green" ? "Nullstill" : "Bekreft"}</button>{/if}</td>
            </tr>
          {/each}
        </tbody>
      </table>
      <h3>Skarp kjøring (fase 3)</h3>
      <table>
        <tbody>
          {#each checks.filter((c) => c.phase === "skarp") as c}
            <tr>
              <td style="width:24px"><span class="lamp {c.status}"></span></td>
              <td>{c.label}</td>
              <td class="muted">{c.ts ? dt(c.ts) : ""} {c.note ?? ""}</td>
              <td>{#if c.kind === "manual"}<button class="ghost" on:click={() => toggleCheck(c)}>{c.status === "green" ? "Nullstill" : "Bekreft"}</button>{/if}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
    <div class="card">
      <h2>Hendelseslogg</h2>
      <table>
        <tbody>
          {#each events as e}
            <tr>
              <td class="muted" style="white-space:nowrap">{dt(e.ts)}</td>
              <td><span class="lamp {e.kind.includes('feil') ? 'red' : 'grey'}"></span>{e.kind}</td>
              <td>{e.message}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</main>
