'use client';
import * as runtime from 'zyrojs/component';
import { createObservable } from '@zeruxjs/zyro';
import { createZyroRendererBridge } from '@zeruxjs/zyro/renderer';
import { createReactStore } from '@zeruxjs/react';
import { createVueRef } from '@zeruxjs/vue';
import { h, defineComponent, signal, computed } from 'zyrojs/component';
import { createProtocolClient, readEventStream } from 'zyrojs/network';
import { mount, unmount } from 'zyrojs/dom';
import {
  createPreferenceState,
  createPreferencePanel,
  applyLabelledComponentProps,
  applyComponentProps,
} from '@zeruxjs/accessibility';
import { createI18n } from 'zlocale';
import {
  createMediaPlayback,
  createMediaControls,
} from '@zeruxjs/media/playback';
import { mountReportChart } from '@zeruxjs/reports/view';
import type { ChartData } from '@zeruxjs/reports';

/** Authored PCM tone, generated locally. No remote asset, codec command or autoplay. */
/** Create one short authored PCM/WAV Blob locally, without autoplay or transcoding.
 * @returns {Blob} Quarter-second 440Hz mono PCM fixture; playback support remains browser-dependent.
 */
function tone() {
  /** Fixed authored mono PCM sample rate; no remote media or codec process is used. */
  const rate = 8000,
    samples = 2000,
    bytes = new ArrayBuffer(44 + samples * 2),
    view = new DataView(bytes);
  /** Decoded report text has a post-read size guard; this is not a prebuffer streaming byte limit. */
  /** Write fixed ASCII WAV header bytes into the owned output buffer.
   * @param {number} at - Authored byte offset within the fixed header.
   * @param {string} value - Fixed header signature text, never executable source.
   * @returns {void} Updates only the fixture buffer.
   */
  const text = (at: number, value: string) =>
    [...value].forEach((char, index) =>
      view.setUint8(at + index, char.charCodeAt(0))
    );
  text(0, 'RIFF');
  view.setUint32(4, 36 + samples * 2, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, 'data');
  view.setUint32(40, samples * 2, true);
  for (let index = 0; index < samples; index++) {
    view.setInt16(
      44 + index * 2,
      Math.sin((index * 2 * Math.PI * 440) / rate) * 5000,
      true
    );
  }
  return new Blob([bytes], { type: 'audio/wav' });
}
/** Install one browser page scope over explicit native containers and trusted public adapters.
 * @returns {() => void} Page teardown signals cancellation and releases acquired UI owners; arbitrary promises remain cooperative.
 */
function install() {
  /** Page-scope native listeners, renderer roots, stores and media owners released on page exit. */
  const disposers: Array<() => void> = [],
    controller = new AbortController();
  for (const form of document.querySelectorAll<HTMLFormElement>(
    'form[method="post"]'
  )) {
    let submitting = false;
    /** Preserve the form’s authored busy state when this enhancement is removed. */
    const previousBusy = form.getAttribute('aria-busy');
    /** Exact prior disabled flags; UI feedback is not request idempotency or authorization. */
    const buttonStates = new Map<HTMLButtonElement, boolean>();
    /** Provide duplicate-submit UI feedback while native navigation retains dispatch ownership.
     * @param {SubmitEvent} event - Native form submission event; server CSRF/revisions remain authoritative.
     * @returns {void} Prevents repeat UI submissions and records prior native control states.
     */
    const handler = (event: SubmitEvent) => {
      if (submitting) {
        event.preventDefault();
        return;
      }
      submitting = true;
      form.setAttribute('aria-busy', 'true');
      // Native navigation owns dispatch, CSRF, errors and redirects. UI disabling is not idempotency.
      for (const button of form.querySelectorAll<HTMLButtonElement>(
        'button[type="submit"]'
      )) {
        buttonStates.set(button, button.disabled);
        button.disabled = true;
      }
    };
    form.addEventListener('submit', handler);
    disposers.push(() => {
      form.removeEventListener('submit', handler);
      if (form.getAttribute('aria-busy') === 'true') {
        if (previousBusy === null) {
          form.removeAttribute('aria-busy');
        } else {
          form.setAttribute('aria-busy', previousBusy);
        }
      }
      for (const [button, disabled] of buttonStates) {
        if (button.disabled) {
          button.disabled = disabled;
        }
      }
    });
  }
  /** Dedicated browser-lab island, separate from the server-rendered document shell. */
  const host = document.querySelector<HTMLElement>('[data-browser-lab]');
  if (host) {
    /** App-owned observable store, explicitly destroyed after bridge subscriptions detach. */
    const source = createObservable(0),
      reactStore = createReactStore(0),
      vueRef = createVueRef(0);
    /** App-owned conversion scope; source stores remain borrowed by the bridge itself. */
    const bridge = createZyroRendererBridge(runtime, {
      signal: controller.signal,
      maxConnections: 4,
    });
    /** Writable bridge binding plus read-only React/Vue standalone-store views, all rendered through ZyroJS. */
    const counter = bridge.write(source),
      reactCounter = bridge.read({
        get: reactStore.getSnapshot,
        subscribe: (listener) =>
          reactStore.subscribe(() => listener(reactStore.getSnapshot())),
      }),
      vueCounter = bridge.read({
        get: () => vueRef.value,
        subscribe: vueRef.subscribe,
      });
    /** Local demo language only; never a server tenant/site preference or cross-request global locale. */
    const locale = signal('en');
    /** Batch one authored counter step across standalone stores through explicit bridge conversions.
     * @param {number} delta - Fixed button-selected increment/decrement, not a remotely supplied command.
     * @returns {void} Publishes one synchronous update batch without creating React/Vue DOM runtimes.
     */
    const step = (delta: number) =>
      bridge.batch(() => {
        counter.value += delta;
        reactStore.set((value) => value + delta);
        vueRef.value += delta;
      });
    /** Explicit in-memory text-domain catalogs; this demo performs no catalog network load. */
    const i18n = createI18n({
      domain: 'workspace',
      locale: 'en',
      catalogs: [
        {
          locale: 'hi',
          domain: 'workspace',
          messages: {
            'Local reactive counter': 'स्थानीय प्रतिक्रियाशील काउंटर',
            Increase: 'बढ़ाएं',
            Decrease: 'घटाएं',
          },
        },
        {
          locale: 'ar',
          domain: 'workspace',
          messages: {
            'Local reactive counter': 'عداد تفاعلي محلي',
            Increase: 'زيادة',
            Decrease: 'تقليل',
          },
        },
      ],
    });
    /** Derived locale-fixed translator, explicitly disposed during page teardown. */
    const value = computed(() => i18n.forLocale(locale.value));
    /** One-time setup component with synchronous renders; browser-selected text is never evaluated. */
    const Counter = defineComponent(
      () => () =>
        h(
          'section',
          {
            class: 'card',
            lang: locale.value,
            dir: value.value.isRTL() ? 'rtl' : 'ltr',
          },
          h('h2', null, value.value.__('Local reactive counter', 'workspace')),
          h(
            'label',
            null,
            'Demo language / भाषा / اللغة',
            h(
              'select',
              {
                value: locale.value,
                onChange: (event: Event) => {
                  /** Candidate language from the native select, accepted only from the authored allowlist. */
                  const next = (event.target as HTMLSelectElement).value;
                  if (['en', 'hi', 'ar'].includes(next)) {
                    locale.value = next;
                  }
                },
              },
              ['en', 'hi', 'ar'].map((code) =>
                h('option', { value: code }, code)
              )
            )
          ),
          h(
            'p',
            { role: 'status', 'aria-live': 'polite' },
            value.value.formatNumber(counter.value)
          ),
          h(
            'p',
            null,
            `Standalone adapter stores — React: ${reactCounter.value}; Vue: ${vueCounter.value}. Both are rendered by ZyroJS; no React/Vue DOM runtime is started.`
          ),
          h(
            'button',
            { type: 'button', onClick: () => step(-1) },
            value.value.__('Decrease', 'workspace')
          ),
          h(
            'button',
            { type: 'button', onClick: () => step(1) },
            value.value.__('Increase', 'workspace')
          )
        )
    );
    /** App-owned island container; unmount detaches all renderer listeners before removing it. */
    const counterHost = document.createElement('div');
    host.append(counterHost);
    mount(h(Counter, null), counterHost);
    disposers.push(() => {
      unmount(counterHost);
      value.dispose();
      bridge.destroy();
      source.destroy();
      reactStore.destroy();
      counterHost.remove();
    });
    /** Nonpersisted app-owned preference state; no remote collection or stored speech activation. */
    const preferences = createPreferenceState();
    /** Dedicated native controls container for this page’s preference owner. */
    const preferenceHost = document.createElement('section');
    host.append(preferenceHost);
    /** Response-owned style nonce from fixed metadata, never a permission or session token. */
    const nonce = document.querySelector<HTMLMetaElement>(
      'meta[name="workspace-style-nonce"]'
    )?.content;
    /** Owned accessible preference UI scoped to main; destroy removes its styles/listeners. */
    const panel = createPreferencePanel(preferenceHost, preferences, {
      target: document.querySelector('main')!,
      nonce,
    });
    disposers.push(() => {
      panel.destroy();
      preferences.destroy();
      preferenceHost.remove();
    });
    /** App-owned playback section and native controls; media starts only through explicit user action. */
    const mediaHost = document.createElement('section'),
      heading = document.createElement('h2'),
      audio = document.createElement('audio'),
      controlsHost = document.createElement('div');
    heading.textContent = 'Local audio capability check';
    audio.controls = true;
    audio.volume = 0.15;
    audio.setAttribute('aria-label', 'Quarter-second generated tone');
    mediaHost.append(heading, audio, controlsHost);
    host.append(mediaHost);
    /** Owned native playback controller with only the generated registered WAV variant. */
    const playback = createMediaPlayback(audio, {
      variants: [
        {
          id: 'local-tone',
          contentType: 'audio/wav',
          source: { blob: tone() },
        },
      ],
    });
    /** Owned labelled playback controls; native audio controls remain available as fallback. */
    const controls = createMediaControls(controlsHost, playback, {
      label: 'Generated tone playback',
      accessibility: { applyLabelledComponentProps, applyComponentProps },
    });
    void playback.select('local-tone');
    disposers.push(() => {
      controls.destroy();
      playback.destroy();
      mediaHost.remove();
    });
  }
  /** Dedicated authenticated protocol controls; no browser-provided tool registry is accepted. */
  const protocolHost = document.querySelector<HTMLElement>(
    '[data-protocol-client]'
  );
  if (protocolHost) {
    /** Current session-bound CSRF proof read from the authored page; never stored remotely or logged. */
    const token =
      document.querySelector<HTMLInputElement>('input[readonly]')?.value;
    if (token) {
      /** Inert same-origin protocol client; fixed actions alone start requests and no mutation is retried. */
      const client = createProtocolClient({
        baseUrl: location.origin,
        credentials: 'same-origin',
        timeoutMs: 4000,
        maxResponseBytes: 65536,
        headers: { 'x-csrf-token': token },
      });
      /** Owned native protocol result section, removed with its listener registrations. */
      const region = document.createElement('section'),
        output = document.createElement('pre'),
        status = document.createElement('p');
      status.setAttribute('role', 'status');
      region.append(status, output);
      protocolHost.append(region);
      let active = false,
        stream: AbortController | undefined;
      /** Explicit trusted read-only functions; neither returned data nor caller text selects executable operations. */
      const operations = [
        [
          'JSON-RPC summary',
          /** Call the fixed read-only local operation.
           * @returns {Promise<unknown>} Correlated JSON-RPC summary from the fixed authenticated local method.
           */
          () =>
            client.rpc('workspace.summary', {}, { signal: controller.signal }),
        ],
        [
          'MCP tool call',
          /** Call the fixed read-only local operation.
           * @returns {Promise<unknown>} Actual JSON-response MCP tool result from the explicitly registered summary tool.
           */
          () =>
            client.mcp(
              'tools/call',
              { name: 'workspace_summary', arguments: {} },
              { signal: controller.signal }
            ),
        ],
        [
          'Connect summary',
          /** Call the fixed read-only local operation.
           * @returns {Promise<unknown>} Actual unary Connect summary from the fixed authored service/method.
           */
          () =>
            client.connect(
              'workspace.Notebook',
              'Summary',
              {},
              { signal: controller.signal }
            ),
        ],
        [
          'tRPC-style summary',
          /** Call the fixed read-only local operation.
           * @returns {Promise<unknown>} Unwrapped tRPC-style local summary result.
           */
          () =>
            client.trpc('workspace.summary', {}, { signal: controller.signal }),
        ],
      ] as const;
      for (const [label, invoke] of operations) {
        /** Native labelled action button, paired with an exact listener disposer. */
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = label;
        /** Invoke only the selected explicitly registered read-only operation.
         * @returns {Promise<void>} Displays an actual response or safe unavailable text; cancellation fences late UI commits.
         */
        const handler = async () => {
          if (active) {
            return;
          }
          active = true;
          status.textContent = 'Calling authenticated local endpoint…';
          try {
            /** Actual authenticated local endpoint result, displayed through bounded inert text only. */
            const result = await invoke();
            if (!controller.signal.aborted) {
              output.textContent = JSON.stringify(result, null, 2).slice(
                0,
                65536
              );
              status.textContent = 'Local endpoint responded.';
            }
          } catch {
            if (!controller.signal.aborted) {
              status.textContent =
                'Call failed or expired. Reload to renew your session/CSRF token.';
            }
          } finally {
            active = false;
          }
        };
        button.addEventListener('click', handler);
        region.prepend(button);
        disposers.push(() => button.removeEventListener('click', handler));
      }
      /** Explicit start/stop control for one finite server-side SSE connection. */
      const events = document.createElement('button');
      events.type = 'button';
      events.textContent = 'Listen for 5 seconds';
      region.append(events);
      /** Explicitly start or stop one SSE wait; cancellation is not transfer resumption.
       * @returns {Promise<void>} Actual reader settlement; listener/controller ownership is released in finally.
       */
      const listen = async () => {
        if (stream) {
          stream.abort();
          return;
        }
        /** This SSE attempt’s controller identity, distinct from the whole page scope. */
        const owner = (stream = new AbortController());
        /** Forward page teardown to the active SSE controller only.
         * @returns {void} Signals cooperative cancellation without affecting any unrelated connection.
         */
        const abort = () => owner.abort();
        controller.signal.addEventListener('abort', abort, { once: true });
        events.textContent = 'Stop listening';
        status.textContent = 'Listening for metadata-only note.saved events.';
        /** At most ten metadata-only event lines retained for local display. */
        const received: string[] = [];
        try {
          for await (const event of readEventStream('/events', {
            signal: owner.signal,
            credentials: 'same-origin',
            maxEventBytes: 2048,
          })) {
            received.push(event.event + ': ' + event.data);
            if (received.length > 10) {
              received.shift();
            }
            output.textContent = received.join('\n');
          }
        } catch {
          if (!controller.signal.aborted && !owner.signal.aborted) {
            status.textContent = 'Event connection unavailable.';
          }
        } finally {
          controller.signal.removeEventListener('abort', abort);
          if (stream === owner) {
            stream = undefined;
          }
          if (!controller.signal.aborted) {
            events.textContent = 'Listen for 5 seconds';
            status.textContent =
              'Event connection stopped. Reconnect explicitly.';
          }
        }
      };
      events.addEventListener('click', listen);
      disposers.push(() => {
        stream?.abort();
        events.removeEventListener('click', listen);
        region.remove();
      });
    }
  }
  /** Dedicated replaceable report-view container, independent of server authorization. */
  const reportHost = document.querySelector<HTMLElement>('[data-report-view]');
  if (reportHost) {
    void (async () => {
      try {
        /** Same-origin authorized report response; redirects reject rather than forwarding credentials elsewhere. */
        const response = await fetch('/workspace/report-data', {
          signal: controller.signal,
          credentials: 'same-origin',
          redirect: 'error',
        });
        if (!response.ok) {
          throw new Error('REPORT_UNAVAILABLE');
        }
        /** Decoded report text has a post-read size guard; this is not a prebuffer streaming byte limit. */
        const text = await response.text();
        if (text.length > 65536) {
          throw new Error('REPORT_LIMIT');
        }
        /** Owned report-view handle; late responses are destroyed if the page scope has already ended. */
        const chart = mountReportChart(
          reportHost,
          JSON.parse(text) as ChartData,
          { timeZone: 'UTC', pageSize: 10 }
        );
        if (controller.signal.aborted) {
          chart.destroy();
        } else {
          disposers.push(() => chart.destroy());
        }
      } catch {
        if (!controller.signal.aborted) {
          /** Owned report-view handle; late responses are destroyed if the page scope has already ended. */
          const chart = mountReportChart(reportHost, null);
          disposers.push(() => chart.destroy());
        }
      }
    })();
  }
  return () => {
    controller.abort();
    for (const dispose of disposers.reverse()) {
      dispose();
    }
  };
}
let dispose = install();
window.addEventListener('pagehide', () => {
  dispose();
});
window.addEventListener('pageshow', (event) => {
  if (event.persisted) {
    dispose = install();
  }
});
