'use client';
import * as runtime from 'zyrojs/component';
import { createObservable } from '@zeruxjs/zyro';
import { createZyroRendererBridge } from '@zeruxjs/zyro/renderer';
import { createReactStore } from '@zeruxjs/react';
import { createVueRef } from '@zeruxjs/vue';
import { h, defineComponent, signal, computed } from 'zyrojs/component';
import { createProtocolClient, readEventStream } from 'zyrojs/network';
import { mount, unmount } from 'zyrojs/dom';
import { createPreferenceState, createPreferencePanel, applyLabelledComponentProps, applyComponentProps } from '@zeruxjs/accessibility';
import { createI18n } from 'zlocale';
import { createMediaPlayback, createMediaControls } from '@zeruxjs/media/playback';
import { mountReportChart } from '@zeruxjs/reports/view';
import type { ChartData } from '@zeruxjs/reports';

/** Authored PCM tone, generated locally. No remote asset, codec command or autoplay. */
function tone() {
  const rate = 8000, samples = 2000, bytes = new ArrayBuffer(44 + samples * 2), view = new DataView(bytes);
  const text = (at: number, value: string) => [...value].forEach((char, index) => view.setUint8(at + index, char.charCodeAt(0)));
  text(0, 'RIFF'); view.setUint32(4, 36 + samples * 2, true); text(8, 'WAVE'); text(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true); text(36, 'data'); view.setUint32(40, samples * 2, true);
  for (let index = 0; index < samples; index++) view.setInt16(44 + index * 2, Math.sin(index * 2 * Math.PI * 440 / rate) * 5000, true);
  return new Blob([bytes], { type: 'audio/wav' });
}
function install() {
  const disposers: Array<() => void> = [], controller = new AbortController();
  for (const form of document.querySelectorAll<HTMLFormElement>('form[method="post"]')) {
    let submitting = false;
    const previousBusy = form.getAttribute('aria-busy');
    const buttonStates = new Map<HTMLButtonElement, boolean>();
    const handler = (event: SubmitEvent) => {
      if (submitting) { event.preventDefault(); return; }
      submitting = true; form.setAttribute('aria-busy', 'true');
      // Native navigation owns dispatch, CSRF, errors and redirects. UI disabling is not idempotency.
      for (const button of form.querySelectorAll<HTMLButtonElement>('button[type="submit"]')) { buttonStates.set(button, button.disabled); button.disabled = true; }
    };
    form.addEventListener('submit', handler);
    disposers.push(() => { form.removeEventListener('submit', handler); if (form.getAttribute('aria-busy') === 'true') { if (previousBusy === null) form.removeAttribute('aria-busy'); else form.setAttribute('aria-busy', previousBusy); } for (const [button, disabled] of buttonStates) if (button.disabled) button.disabled = disabled; });
  }
  const host = document.querySelector<HTMLElement>('[data-browser-lab]');
  if (host) {
    const source = createObservable(0), reactStore = createReactStore(0), vueRef = createVueRef(0);
    const bridge = createZyroRendererBridge(runtime, { signal: controller.signal, maxConnections: 4 });
    const counter = bridge.write(source), reactCounter = bridge.read({ get: reactStore.getSnapshot, subscribe: listener => reactStore.subscribe(() => listener(reactStore.getSnapshot())) }), vueCounter = bridge.read({ get: () => vueRef.value, subscribe: vueRef.subscribe });
    const locale = signal('en');
    const step = (delta: number) => bridge.batch(() => { counter.value += delta; reactStore.set(value => value + delta); vueRef.value += delta; });
    const i18n = createI18n({ domain: 'workspace', locale: 'en', catalogs: [
      { locale: 'hi', domain: 'workspace', messages: { 'Local reactive counter': 'स्थानीय प्रतिक्रियाशील काउंटर', 'Increase': 'बढ़ाएं', 'Decrease': 'घटाएं' } },
      { locale: 'ar', domain: 'workspace', messages: { 'Local reactive counter': 'عداد تفاعلي محلي', 'Increase': 'زيادة', 'Decrease': 'تقليل' } },
    ] });
    const value = computed(() => i18n.forLocale(locale.value));
    const Counter = defineComponent(() => () => h('section', { class: 'card', lang: locale.value, dir: value.value.isRTL() ? 'rtl' : 'ltr' },
      h('h2', null, value.value.__('Local reactive counter', 'workspace')),
      h('label', null, 'Demo language / भाषा / اللغة', h('select', { value: locale.value, onChange: (event: Event) => { const next = (event.target as HTMLSelectElement).value; if (['en', 'hi', 'ar'].includes(next)) locale.value = next; } }, ['en', 'hi', 'ar'].map(code => h('option', { value: code }, code)))),
      h('p', { role: 'status', 'aria-live': 'polite' }, value.value.formatNumber(counter.value)),
      h('p', null, `Standalone adapter stores — React: ${reactCounter.value}; Vue: ${vueCounter.value}. Both are rendered by ZyroJS; no React/Vue DOM runtime is started.`),
      h('button', { type: 'button', onClick: () => step(-1) }, value.value.__('Decrease', 'workspace')),
      h('button', { type: 'button', onClick: () => step(1) }, value.value.__('Increase', 'workspace'))));
    const counterHost = document.createElement('div'); host.append(counterHost); mount(h(Counter, null), counterHost);
    disposers.push(() => { unmount(counterHost); value.dispose(); bridge.destroy(); source.destroy(); reactStore.destroy(); counterHost.remove(); });
    const preferences = createPreferenceState();
    const preferenceHost = document.createElement('section'); host.append(preferenceHost);
    const nonce = document.querySelector<HTMLMetaElement>('meta[name="workspace-style-nonce"]')?.content;
    const panel = createPreferencePanel(preferenceHost, preferences, { target: document.querySelector('main')!, nonce });
    disposers.push(() => { panel.destroy(); preferences.destroy(); preferenceHost.remove(); });
    const mediaHost = document.createElement('section'), heading = document.createElement('h2'), audio = document.createElement('audio'), controlsHost = document.createElement('div');
    heading.textContent = 'Local audio capability check'; audio.controls = true; audio.volume = 0.15; audio.setAttribute('aria-label', 'Quarter-second generated tone'); mediaHost.append(heading, audio, controlsHost); host.append(mediaHost);
    const playback = createMediaPlayback(audio, { variants: [{ id: 'local-tone', contentType: 'audio/wav', source: { blob: tone() } }] });
    const controls = createMediaControls(controlsHost, playback, { label: 'Generated tone playback', accessibility: { applyLabelledComponentProps, applyComponentProps } });
    void playback.select('local-tone');
    disposers.push(() => { controls.destroy(); playback.destroy(); mediaHost.remove(); });
  }
  const protocolHost = document.querySelector<HTMLElement>('[data-protocol-client]');
  if (protocolHost) {
    const token = document.querySelector<HTMLInputElement>('input[readonly]')?.value;
    if (token) {
      const client = createProtocolClient({ baseUrl: location.origin, credentials: 'same-origin', timeoutMs: 4000, maxResponseBytes: 65536, headers: { 'x-csrf-token': token } });
      const region = document.createElement('section'), output = document.createElement('pre'), status = document.createElement('p'); status.setAttribute('role', 'status');
      region.append(status, output); protocolHost.append(region);
      let active = false, stream: AbortController | undefined;
      const operations = [
        ['JSON-RPC summary', () => client.rpc('workspace.summary', {}, { signal: controller.signal })],
        ['MCP tool call', () => client.mcp('tools/call', { name: 'workspace_summary', arguments: {} }, { signal: controller.signal })],
        ['Connect summary', () => client.connect('workspace.Notebook', 'Summary', {}, { signal: controller.signal })],
        ['tRPC-style summary', () => client.trpc('workspace.summary', {}, { signal: controller.signal })],
      ] as const;
      for (const [label, invoke] of operations) {
        const button = document.createElement('button'); button.type = 'button'; button.textContent = label;
        const handler = async () => {
          if (active) return; active = true; status.textContent = 'Calling authenticated local endpoint…';
          try { const result = await invoke(); if (!controller.signal.aborted) { output.textContent = JSON.stringify(result, null, 2).slice(0, 65536); status.textContent = 'Local endpoint responded.'; } }
          catch { if (!controller.signal.aborted) status.textContent = 'Call failed or expired. Reload to renew your session/CSRF token.'; }
          finally { active = false; }
        };
        button.addEventListener('click', handler); region.prepend(button); disposers.push(() => button.removeEventListener('click', handler));
      }
      const events = document.createElement('button'); events.type = 'button'; events.textContent = 'Listen for 5 seconds'; region.append(events);
      const listen = async () => {
        if (stream) { stream.abort(); return; }
        const owner = stream = new AbortController(); const abort = () => owner.abort(); controller.signal.addEventListener('abort', abort, { once: true });
        events.textContent = 'Stop listening'; status.textContent = 'Listening for metadata-only note.saved events.';
        const received: string[] = [];
        try { for await (const event of readEventStream('/events', { signal: owner.signal, credentials: 'same-origin', maxEventBytes: 2048 })) { received.push(event.event + ': ' + event.data); if (received.length > 10) received.shift(); output.textContent = received.join('\n'); } }
        catch { if (!controller.signal.aborted && !owner.signal.aborted) status.textContent = 'Event connection unavailable.'; }
        finally { controller.signal.removeEventListener('abort', abort); if (stream === owner) stream = undefined; if (!controller.signal.aborted) { events.textContent = 'Listen for 5 seconds'; status.textContent = 'Event connection stopped. Reconnect explicitly.'; } }
      };
      events.addEventListener('click', listen);
      disposers.push(() => { stream?.abort(); events.removeEventListener('click', listen); region.remove(); });
    }
  }
  const reportHost = document.querySelector<HTMLElement>('[data-report-view]');
  if (reportHost) {
    void (async () => {
      try {
        const response = await fetch('/workspace/report-data', { signal: controller.signal, credentials: 'same-origin', redirect: 'error' });
        if (!response.ok) throw new Error('REPORT_UNAVAILABLE');
        const text = await response.text(); if (text.length > 65536) throw new Error('REPORT_LIMIT');
        const chart = mountReportChart(reportHost, JSON.parse(text) as ChartData, { timeZone: 'UTC', pageSize: 10 });
        if (controller.signal.aborted) chart.destroy(); else disposers.push(() => chart.destroy());
      } catch { if (!controller.signal.aborted) { const chart = mountReportChart(reportHost, null); disposers.push(() => chart.destroy()); } }
    })();
  }
  return () => { controller.abort(); for (const dispose of disposers.reverse()) dispose(); };
}
let dispose = install();
window.addEventListener('pagehide', () => { dispose(); });
window.addEventListener('pageshow', event => { if (event.persisted) dispose = install(); });
