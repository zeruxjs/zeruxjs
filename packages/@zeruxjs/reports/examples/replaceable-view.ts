import {
  importReportDefinition,
  resolveReportLayout,
  type ChartData,
} from '@zeruxjs/reports/definitions';
import { mountReportChart } from '@zeruxjs/reports/view';

// Host owns authenticated fetches, source authorization, and saved revision conflicts.
/** Validate an inert definition, match the authorized supplied result to its page and mount one replaceable view. Fetch/session authorization/CAS and source execution remain host responsibilities.
 * @param {HTMLElement} host - Borrowed real DOM host for the inserted view subtree.
 * @param {string} definitionJson - Bounded inert definition transfer, never callbacks or source expressions.
 * @param {ChartData} data - Already authorized ChartData for an existing selected page chart.
 * @returns {function} Synchronous disposer for the inserted view; invoke on owner/route teardown.
 */
export function showReport(
  host: HTMLElement,
  definitionJson: string,
  data: ChartData
) {
  /** Validated inert transferred document, not source execution or a persistence override. */
  const document = importReportDefinition(definitionJson);
  /** Existing selected page checked against the supplied result chart ID. */
  const page = document.reports[0]?.pages[0];
  if (!page || !page.charts.some((chart) => chart.id === data.id)) {
    throw new TypeError('Result does not belong to the selected page');
  }
  /** Validated presentation-only zone/span ordering; never source authorization. */
  const layout = resolveReportLayout(page);
  /** Owned mounted chart/table subtree; return its explicit destroy callback to the host. */
  const view = mountReportChart(host, data, {
    timeZone: layout.timeZone,
    pageSize: 20,
    components: {
      /** Render a trusted host summary with inert text while preserving the shared accessible table. Never persist this callback in a saved definition.
       * @param {HTMLElement} container - Owned custom component slot supplied by the view.
       * @param {Readonly<ChartData>} result - Frozen authorized chart snapshot with source coverage.
       * @returns {function} Synchronous component disposer, called by the view owner.
       */
      chart(container, result) {
        /** Owned host component text node removed by its synchronous disposer. */
        const summary = container.ownerDocument.createElement('p');
        summary.textContent = `Host summary: ${result.total}`;
        container.append(summary); // Shared accessible table is retained below it.
        return () => summary.remove();
      },
    },
  });
  return () => view.destroy();
}
