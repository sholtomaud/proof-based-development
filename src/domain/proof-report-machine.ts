import {
  isProofTierId,
  type ProofE2EMediaItem,
  type ProofReport,
  type ProofTier,
  type ProofTierId,
} from '../shared/proof-report.ts';

export type TierFilter = 'all' | ProofTierId;

export type ProofDashboardLoadStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface ProofDashboardState {
  readonly loadStatus: ProofDashboardLoadStatus;
  readonly report: ProofReport | null;
  readonly errorMessage: string;
  readonly selectedTier: TierFilter;
  readonly selectedProject: string;
  readonly searchQuery: string;
}

export type ProofDashboardAction =
  | { readonly type: 'loadStarted' }
  | { readonly type: 'loadSucceeded'; readonly report: ProofReport }
  | { readonly type: 'loadFailed'; readonly message: string }
  | { readonly type: 'selectTier'; readonly tier: TierFilter }
  | { readonly type: 'selectProject'; readonly project: string }
  | { readonly type: 'setSearchQuery'; readonly query: string };

export function isTierFilter(value: unknown): value is TierFilter {
  return value === 'all' || isProofTierId(value);
}

export function createInitialProofDashboardState(): ProofDashboardState {
  return {
    loadStatus: 'idle',
    report: null,
    errorMessage: '',
    selectedTier: 'all',
    selectedProject: 'all',
    searchQuery: '',
  };
}

export function transitionProofDashboard(
  state: ProofDashboardState,
  action: ProofDashboardAction
): ProofDashboardState {
  switch (action.type) {
    case 'loadStarted':
      return {
        ...state,
        loadStatus: 'loading',
        errorMessage: '',
      };
    case 'loadSucceeded': {
      const availableProjects = selectAvailableProjectsFromReport(
        action.report
      );
      const selectedProject =
        state.selectedProject === 'all' ||
        availableProjects.includes(state.selectedProject)
          ? state.selectedProject
          : 'all';
      return {
        ...state,
        loadStatus: 'ready',
        report: action.report,
        errorMessage: '',
        selectedProject,
      };
    }
    case 'loadFailed':
      return {
        ...state,
        loadStatus: 'error',
        errorMessage: action.message.trim() || 'Could not load proof report.',
      };
    case 'selectTier':
      if (!isTierFilter(action.tier) || action.tier === state.selectedTier) {
        return state;
      }
      return { ...state, selectedTier: action.tier };
    case 'selectProject': {
      const normalized = action.project.trim() || 'all';
      if (state.report && normalized !== 'all') {
        const projects = selectAvailableProjectsFromReport(state.report);
        if (!projects.includes(normalized)) {
          return { ...state, selectedProject: 'all' };
        }
      }
      if (normalized === state.selectedProject) return state;
      return { ...state, selectedProject: normalized };
    }
    case 'setSearchQuery':
      if (action.query === state.searchQuery) return state;
      return { ...state, searchQuery: action.query };
  }
}

function selectAvailableProjectsFromReport(report: ProofReport): string[] {
  const seen = new Set<string>();
  const projects: string[] = [];
  for (const item of report.e2eMedia) {
    if (!seen.has(item.project)) {
      seen.add(item.project);
      projects.push(item.project);
    }
  }
  return projects;
}

export function selectAvailableProjects(
  state: ProofDashboardState
): readonly string[] {
  if (!state.report) return [];
  return selectAvailableProjectsFromReport(state.report);
}

export function selectVisibleTiers(
  state: ProofDashboardState
): readonly ProofTier[] {
  if (!state.report) return [];
  const query = state.searchQuery.trim().toLowerCase();
  return state.report.tiers
    .filter(
      (tier) => state.selectedTier === 'all' || tier.id === state.selectedTier
    )
    .map((tier) => {
      if (query.length === 0) return tier;
      const matchingChecks = tier.checks.filter(
        (check) =>
          check.name.toLowerCase().includes(query) ||
          check.summary.toLowerCase().includes(query) ||
          check.command.toLowerCase().includes(query) ||
          check.details.some((detail) => detail.toLowerCase().includes(query))
      );
      return { ...tier, checks: matchingChecks };
    })
    .filter((tier) => query.length === 0 || tier.checks.length > 0);
}

export function selectVisibleMedia(
  state: ProofDashboardState
): readonly ProofE2EMediaItem[] {
  if (!state.report) return [];
  const query = state.searchQuery.trim().toLowerCase();
  return state.report.e2eMedia.filter((item) => {
    const projectMatch =
      state.selectedProject === 'all' || item.project === state.selectedProject;
    if (!projectMatch) return false;
    if (query.length === 0) return true;
    return (
      item.title.toLowerCase().includes(query) ||
      item.project.toLowerCase().includes(query) ||
      item.file.toLowerCase().includes(query)
    );
  });
}

export function selectOverallPassRate(report: ProofReport): number {
  const executed = report.totalPassed + report.totalFailed;
  if (executed === 0) return 100;
  return Math.round((report.totalPassed / executed) * 1000) / 10;
}

/**
 * Verifies every formal invariant on `ProofDashboardState`.
 * Returns an empty array when all invariants hold.
 */
export function checkProofDashboardInvariants(
  state: ProofDashboardState
): string[] {
  const violations: string[] = [];

  if (!isTierFilter(state.selectedTier)) {
    violations.push(`Invalid selectedTier: ${String(state.selectedTier)}`);
  }

  if (state.selectedProject.length === 0) {
    violations.push('selectedProject must be a non-empty string');
  }

  if (state.loadStatus === 'ready' && state.report === null) {
    violations.push('Ready dashboard state must contain a non-null report');
  }

  if (state.loadStatus === 'error' && state.errorMessage.trim().length === 0) {
    violations.push('Error dashboard state must provide an errorMessage');
  }

  if (state.report) {
    const passRate = selectOverallPassRate(state.report);
    if (passRate < 0 || passRate > 100) {
      violations.push(`Pass rate out of bounds [0, 100]: ${passRate}`);
    }

    const projects = selectAvailableProjects(state);
    if (
      state.selectedProject !== 'all' &&
      !projects.includes(state.selectedProject)
    ) {
      violations.push(
        `selectedProject "${state.selectedProject}" does not exist in report`
      );
    }

    const visibleTiers = selectVisibleTiers(state);
    if (visibleTiers.length > state.report.tiers.length) {
      violations.push('Visible tiers cannot exceed total tiers');
    }

    const visibleMedia = selectVisibleMedia(state);
    if (visibleMedia.length > state.report.e2eMedia.length) {
      violations.push('Visible media cannot exceed total media');
    }
    for (const item of visibleMedia) {
      if (
        state.selectedProject !== 'all' &&
        item.project !== state.selectedProject
      ) {
        violations.push(
          `Visible media item "${item.id}" violates project filter "${state.selectedProject}"`
        );
      }
    }
  }

  return violations;
}
