import type { ChartData } from './types.js';
export interface ReportViewOptions {
  /** Validated IANA display label, default UTC; date-only UTC groups are not rebucketed. */
  timeZone?: string;
  /** Default25, validated1–100 rows per local table page; result is at most500 groups. */
  pageSize?: number;
  /** Explicit unavailable view state, separate from a real empty successful result. */
  state?: 'unavailable';
  /** Optional valid epoch-millisecond result receipt time, default now; not a transaction snapshot timestamp. */
  receivedAt?: number;
  /** Trusted host code only; never stored in a report definition. Table alternative is always retained. */
  components?: {
    chart?: (
      container: HTMLElement,
      data: Readonly<ChartData>
    ) => void | (() => void);
  };
}
/** Mount one explicitly owned view/table subtree under the host. Source queries/authentication remain headless host responsibilities; this self-contained function is also serialized into the CSP-hashed built-in studio.
 * @param {HTMLElement} host - Borrowed real DOM host; existing host attributes/subtrees are not overwritten.
 * @param {ChartData | null} data - Authorized finite chart result, or null for an honest unavailable state; authored labels are text.
 * @param {ReportViewOptions} options - Explicit bounded display/paging settings and optional trusted component/disposal callback.
 * @returns {object} Inserted element and idempotent destroy owner; no global CSS, fetch or credential resource is acquired.
 */
export function mountReportChart(
  host: HTMLElement,
  data: ChartData | null,
  options: ReportViewOptions = {}
) {
  if (!host?.ownerDocument || typeof host.append !== 'function') {
    throw new TypeError('A DOM host is required');
  }
  /** Validated receipt timestamp for display only, never source data time or ranking. */
  const receivedAt = options.receivedAt ?? Date.now();
  if (
    !Number.isSafeInteger(receivedAt) ||
    receivedAt < 0 ||
    receivedAt > 8640000000000000
  ) {
    throw new RangeError('Invalid result receipt time');
  }
  /** Validated finite local page size, default25; never request more backend rows. */
  const pageSize = options.pageSize ?? 25;
  /** Validated IANA display zone; UTC grouping remains source-owned. */
  const timeZone = options.timeZone ?? 'UTC';
  if (
    !Number.isSafeInteger(pageSize) ||
    pageSize < 1 ||
    pageSize > 100 ||
    typeof timeZone !== 'string' ||
    timeZone.length > 100
  ) {
    throw new RangeError('Invalid report view limits');
  }
  try {
    new Intl.DateTimeFormat('en', { timeZone });
  } catch {
    throw new TypeError('Invalid display time zone');
  }
  if (
    data &&
    (![
      'bar',
      'horizontal-bar',
      'line',
      'area',
      'pie',
      'doughnut',
      'scatter',
      'stacked-bar',
      'table',
      'kpi',
    ].includes(data.type) ||
      !Array.isArray(data.labels) ||
      !Array.isArray(data.values) ||
      data.labels.length !== data.values.length ||
      data.labels.length > 500 ||
      typeof data.title !== 'string' ||
      data.title.length > 128 ||
      !Number.isFinite(data.total) ||
      data.labels.some((s) => typeof s !== 'string' || s.length > 4096) ||
      data.values.some((n) => !Number.isFinite(n)) ||
      (data.coverage !== undefined &&
        (typeof data.coverage !== 'string' || data.coverage.length > 512)) ||
      typeof data.truncated !== 'boolean' ||
      !Number.isSafeInteger(data.sampledRows) ||
      data.sampledRows < 0)
  ) {
    throw new TypeError('Invalid chart data');
  }
  /** Borrowed ownerDocument from the explicit host, not an ambient global on import. */
  const document = host.ownerDocument;
  /** Owned inserted labeled region; destroy removes only this subtree. */
  const region = document.createElement('section');
  region.dataset.reportChart = '';
  region.className = 'report-view';
  region.tabIndex = 0;
  region.setAttribute('role', 'region');
  region.setAttribute('aria-label', data?.title ?? 'Unavailable chart');
  /** Owned finite listener/component disposers, released in reverse registration order. */
  const cleanups: Array<() => void> = [];
  let destroyed = false;
  /** Register one listener and retain its exact removal callback.
   * @param {EventTarget} node - Explicit value for this documented owner/projection; host authorization remains separate.
   * @param {string} event - Explicit value for this documented owner/projection; host authorization remains separate.
   * @param {EventListener} callback - Explicit value for this documented owner/projection; host authorization remains separate.
   * @returns {void} Result of this documented read/update/cleanup; borrowed resources remain host-owned.
   */
  const on = (node: EventTarget, event: string, callback: EventListener) => {
    node.addEventListener(event, callback);
    cleanups.push(() => node.removeEventListener(event, callback));
  };
  /** Create inert textContent in the owned subtree, never interpolate authored labels as HTML.
   * @param {string} tag - Explicit value for this documented owner/projection; host authorization remains separate.
   * @param {string} value - Explicit immutable next value or caller-controlled policy input.
   * @param {HTMLElement} parent - Explicit value for this documented owner/projection; host authorization remains separate.
   * @returns {HTMLElement} Result of this documented read/update/cleanup; borrowed resources remain host-owned.
   */
  const text = (tag: string, value: string, parent: HTMLElement = region) => {
    /** Owned inert text element appended under its explicitly selected parent. */
    const el = document.createElement(tag);
    el.textContent = value;
    parent.append(el);
    return el;
  };
  /** Owned live status describing actual empty/unavailable/coverage state. */
  const status = text('p', '');
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  on(region, 'keydown', ((event: KeyboardEvent) => {
    if (
      event.target !== region ||
      !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)
    ) {
      return;
    }
    /** Finite same-board chart regions for explicit region-level keyboard navigation. */
    const siblings = [
      ...((
        region.closest('[data-report-board]') ?? region.parentElement
      )?.querySelectorAll<HTMLElement>('[data-report-chart]') ?? []),
    ];
    if (siblings.length > 500) {
      return;
    }
    let index = siblings.indexOf(region);
    index = (() => {
      if (event.key === 'Home') {
        return 0;
      } else {
        if (event.key === 'End') {
          return siblings.length - 1;
        } else {
          return Math.max(
            0,
            Math.min(
              siblings.length - 1,
              index + (event.key === 'ArrowRight' ? 1 : -1)
            )
          );
        }
      }
    })();
    siblings[index]?.focus();
    event.preventDefault();
  }) as EventListener);
  host.append(region);
  /** Idempotently release every owned listener/component disposer and remove the inserted subtree.
   * @returns {void} Result of this documented read/update/cleanup; borrowed resources remain host-owned.
   */
  const destroy = () => {
    if (destroyed) {
      return;
    }
    destroyed = true;
    // Visit only the finite returned rows/headers/owned disposers; native tab order stays authored.
    for (const clean of cleanups.reverse()) {
      try {
        clean();
      } catch {
        /* Remaining owned listeners must still be released. */
      }
    }
    region.remove();
  };
  try {
    if (!data || options.state === 'unavailable') {
      status.textContent =
        'Report unavailable. Retry through the authorized host.';
      return { element: region, destroy };
    }
    // Snapshot data before calling trusted custom components or retaining local interaction state.
    /** Copied chart arrays retained for local interaction; trusted custom components receive a frozen view. */
    const snapshot: ChartData = {
      ...data,
      labels: [...data.labels],
      values: [...data.values],
    };
    status.textContent = (() => {
      if (snapshot.truncated) {
        return 'Partial data: returned groups or source rows are limited.';
      } else {
        if (snapshot.queryMode === 'sampled') {
          return 'Bounded source sample; not a complete aggregate.';
        } else {
          if (snapshot.queryMode === 'materialized') {
            return 'Indexed numeric facts only; historical or failed facts may be missing.';
          } else {
            if (snapshot.labels.length) {
              return 'Returned report data.';
            } else {
              return 'No data for the selected filters.';
            }
          }
        }
      }
    })();
    text(
      'p',
      'Result received: ' +
        new Intl.DateTimeFormat('en', {
          timeZone,
          dateStyle: 'medium',
          timeStyle: 'long',
        }).format(receivedAt) +
        ' (not a transaction snapshot).'
    );
    text(
      'p',
      `Coverage: ${snapshot.coverage ?? 'unspecified'}; mode: ${snapshot.queryMode ?? 'unknown'}; sampled rows: ${snapshot.sampledRows ?? 0}. Display zone: ${timeZone}; date-only UTC groups are not shifted.`
    );
    if (options.components?.chart) {
      /** Owned custom-component slot; shared semantic table always remains. */
      const custom = text('div', '');
      /** Optional trusted synchronous component cleanup; invalid return types reject and clean the view. */
      const dispose = options.components.chart(
        custom,
        Object.freeze({
          ...snapshot,
          labels: Object.freeze([...snapshot.labels]) as unknown as string[],
          values: Object.freeze([...snapshot.values]) as unknown as number[],
        })
      );
      if (dispose !== undefined && typeof dispose !== 'function') {
        throw new TypeError('Chart component must return a disposer');
      }
      if (dispose) {
        cleanups.push(dispose);
      }
    }
    /** Owned real filter label; no arbitrary inferred accessible name. */
    const label = text('label', 'Filter returned dimensions ');
    /** Owned bounded local dimension filter; changes only the returned groups. */
    const filter = document.createElement('input');
    filter.type = 'search';
    filter.maxLength = 128;
    label.append(filter);
    /** Owned semantic table alternative for every chart kind. */
    const table = document.createElement('table');
    /** Owned inert authored chart title/caption for table context. */
    const caption = document.createElement('caption');
    caption.textContent = `${snapshot.title} — table alternative`;
    table.append(caption);
    /** Owned semantic column header group. */
    const head = document.createElement('thead');
    /** Owned table header row, not an arbitrary source row. */
    const row = document.createElement('tr');
    /** Owned current local table page body. */
    const body = document.createElement('tbody');
    head.append(row);
    table.append(head, body);
    region.append(table);
    let sort: 'dimension' | 'value' = 'dimension',
      direction = 1,
      page = 0,
      term = '';
    /** Finite column-header set retaining accurate aria-sort state. */
    const headers: HTMLTableCellElement[] = [];
    // Visit only the finite returned rows/headers/owned disposers; native tab order stays authored.
    for (const [name, key] of [
      ['Dimension', 'dimension'],
      ['Value', 'value'],
    ] as const) {
      /** Owned column header with explicit scope. */
      const th = document.createElement('th');
      th.scope = 'col';
      headers.push(th);
      /** Owned native sort button; browser keyboard activation remains native. */
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = `Sort by ${name.toLowerCase()}`;
      th.append(button);
      row.append(th);
      on(button, 'click', () => {
        direction = sort === key ? -direction : 1;
        sort = key;
        page = 0;
        render();
      });
    }
    /** Owned local page/coverage notice; no backend totals are invented. */
    const paging = text('p', '');
    /** Owned native previous-page button, disabled at the real local boundary. */
    const previous = document.createElement('button');
    /** Owned native next-page button, disabled at the real local boundary. */
    const next = document.createElement('button');
    previous.type = next.type = 'button';
    previous.textContent = 'Previous rows';
    next.textContent = 'Next rows';
    region.append(previous, next);
    /** At most500 copied returned groups with stable original indices. */
    const rows = snapshot.labels.map((label, i) => ({
      label,
      value: snapshot.values[i],
      index: i,
    }));
    /** Rebuild only the finite returned-group table using local filter/sort/page state. Stable input-index ties and clamped pages never query hidden backend groups or alter authorization.
     * @returns {void} Current bounded table/controls; source execution remains host-owned.
     */
    function render() {
      if (destroyed) {
        return;
      }
      /** Finite local filtered/sorted groups; missing backend records remain unknown. */
      const selected = rows
        .filter((r) => r.label.toLowerCase().includes(term))
        .sort(
          (a, b) =>
            direction *
              (() => {
                if (sort === 'value') {
                  return a.value - b.value;
                } else {
                  if (a.label < b.label) {
                    return -1;
                  } else {
                    if (a.label > b.label) {
                      return 1;
                    } else {
                      return 0;
                    }
                  }
                }
              })() || a.index - b.index
        );
      /** At least one local display page, not a source population count. */
      const count = Math.max(1, Math.ceil(selected.length / pageSize));
      page = Math.min(page, count - 1);
      body.replaceChildren();
      // Visit only the finite returned rows/headers/owned disposers; native tab order stays authored.
      for (const item of selected.slice(
        page * pageSize,
        (page + 1) * pageSize
      )) {
        /** Owned table body row for one returned group. */
        const tr = document.createElement('tr');
        /** Owned semantic row header rendering its label as inert text. */
        const dimension = document.createElement('th');
        /** Owned numeric value cell rendering text, never source HTML. */
        const value = document.createElement('td');
        dimension.scope = 'row';
        dimension.textContent = item.label;
        value.textContent = String(item.value);
        tr.append(dimension, value);
        body.append(tr);
      }
      headers.forEach((h, i) =>
        h.setAttribute(
          'aria-sort',
          (() => {
            if (sort === (i === 0 ? 'dimension' : 'value')) {
              if (direction === 1) {
                return 'ascending';
              } else {
                return 'descending';
              }
            } else {
              return 'none';
            }
          })()
        )
      );
      paging.textContent = `Page ${page + 1} of ${count}; ${selected.length} returned groups. Filtering/sorting does not query missing groups.`;
      previous.disabled = page === 0;
      next.disabled = page + 1 >= count;
    }
    on(filter, 'input', () => {
      term = filter.value.slice(0, 128).toLowerCase();
      page = 0;
      render();
    });
    on(previous, 'click', () => {
      page--;
      render();
    });
    on(next, 'click', () => {
      page++;
      render();
    });
    render();
    return { element: region, destroy };
  } catch (error) {
    destroy();
    throw error;
  }
}
