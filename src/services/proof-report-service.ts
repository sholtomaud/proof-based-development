import { isProofReport, type ProofReport } from '../shared/proof-report.ts';

export type FetchProofReportTransport = (url: string) => Promise<Response>;

/**
 * Loads the generated verification proof report from `public/data/proof-report.json`.
 * Uses a relative URL so it resolves automatically under both `/` and GitHub Pages
 * subpath deployments (`<base href="/proof-based-development/">`).
 */
export async function fetchProofReport(
  fetchImpl: FetchProofReportTransport = (url) => fetch(url)
): Promise<ProofReport> {
  const response = await fetchImpl('data/proof-report.json');
  if (!response.ok) {
    throw new Error(`Could not load proof report (HTTP ${response.status})`);
  }
  const payload: unknown = await response.json();
  if (!isProofReport(payload)) {
    throw new Error('Could not load proof report (invalid report schema)');
  }
  return payload;
}
