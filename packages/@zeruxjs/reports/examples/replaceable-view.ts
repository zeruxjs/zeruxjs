import {
  importReportDefinition, resolveReportLayout, type ChartData,
} from '@zeruxjs/reports/definitions';
import {mountReportChart} from '@zeruxjs/reports/view';

// Host owns authenticated fetches, source authorization, and saved revision conflicts.
export function showReport(host: HTMLElement, definitionJson: string, data: ChartData) {
  const document = importReportDefinition(definitionJson);
  const page = document.reports[0]?.pages[0];
  if (!page || !page.charts.some(chart => chart.id === data.id)) {
    throw new TypeError('Result does not belong to the selected page');
  }
  const layout = resolveReportLayout(page);
  const view = mountReportChart(host, data, {
    timeZone: layout.timeZone, pageSize: 20,
    components: {
      chart(container, result) {
        const summary = container.ownerDocument.createElement('p');
        summary.textContent = `Host summary: ${result.total}`;
        container.append(summary); // Shared accessible table is retained below it.
        return () => summary.remove();
      },
    },
  });
  return () => view.destroy();
}
