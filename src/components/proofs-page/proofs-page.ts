import { BaseComponent } from '../../core/base-component.ts';
import { Store } from '../../core/store.ts';
import {
  createInitialProofDashboardState,
  isTierFilter,
  selectAvailableProjects,
  selectOverallPassRate,
  selectVisibleMedia,
  selectVisibleTiers,
  transitionProofDashboard,
  type ProofDashboardAction,
  type ProofDashboardState,
} from '../../domain/proof-report-machine.ts';
import { fetchProofReport } from '../../services/proof-report-service.ts';
import type { ProofReport, ProofStatus } from '../../shared/proof-report.ts';
import template from './proofs-page.html?raw';
import style from './proofs-page.css?raw';

function formatDuration(ms: number): string {
  if (ms >= 1000) {
    return `${(ms / 1000).toFixed(2)}s`;
  }
  return `${ms}ms`;
}

function applyStatusPillStyle(el: Element, status: ProofStatus): void {
  el.textContent = status;
  el.classList.remove(
    'bg-emerald-100',
    'dark:bg-emerald-950/60',
    'text-emerald-800',
    'dark:text-emerald-300',
    'bg-rose-100',
    'dark:bg-rose-950/60',
    'text-rose-800',
    'dark:text-rose-300',
    'bg-amber-100',
    'dark:bg-amber-950/60',
    'text-amber-800',
    'dark:text-amber-300'
  );
  if (status === 'passed') {
    el.classList.add(
      'bg-emerald-100',
      'dark:bg-emerald-950/60',
      'text-emerald-800',
      'dark:text-emerald-300'
    );
  } else if (status === 'failed') {
    el.classList.add(
      'bg-rose-100',
      'dark:bg-rose-950/60',
      'text-rose-800',
      'dark:text-rose-300'
    );
  } else {
    el.classList.add(
      'bg-amber-100',
      'dark:bg-amber-950/60',
      'text-amber-800',
      'dark:text-amber-300'
    );
  }
}

/**
 * Interactive 4-Tier Proof Verification Dashboard built with Boba Web Components.
 * Delegates all filter and view state transitions to `src/domain/proof-report-machine.ts`.
 */
export class ProofsPageComponent extends BaseComponent {
  static tagName = 'proofs-page';
  private store = new Store<ProofDashboardState>(
    createInitialProofDashboardState()
  );

  constructor() {
    super(template, style);
  }

  private dispatch(action: ProofDashboardAction): void {
    const next = transitionProofDashboard(this.store.getState(), action);
    this.store.setState(next);
  }

  async init() {
    this.store.addEventListener('change', () => this.render());

    this.delegate('click', '[data-tier-filter]', (_, el) => {
      const value = el.getAttribute('data-tier-filter');
      if (isTierFilter(value)) {
        this.dispatch({ type: 'selectTier', tier: value });
      }
    });

    this.delegate('click', '[data-project-filter]', (_, el) => {
      const value = el.getAttribute('data-project-filter') ?? 'all';
      this.dispatch({ type: 'selectProject', project: value });
    });

    const searchInput = this.querySelector('[data-testid="proofs-search"]');
    if (searchInput instanceof HTMLInputElement) {
      searchInput.addEventListener('input', () => {
        this.dispatch({ type: 'setSearchQuery', query: searchInput.value });
      });
    }

    this.dispatch({ type: 'loadStarted' });
    try {
      const report = await fetchProofReport();
      this.dispatch({ type: 'loadSucceeded', report });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.dispatch({ type: 'loadFailed', message });
    }
  }

  private render(): void {
    const state = this.store.getState();
    this.renderTierFilterButtons(state.selectedTier);

    const statusEl = this.querySelector('[data-testid="proofs-status"]');
    if (statusEl) {
      if (state.loadStatus === 'error') {
        statusEl.textContent = state.errorMessage;
        statusEl.classList.remove('hidden');
      } else {
        statusEl.textContent = '';
        statusEl.classList.add('hidden');
      }
    }

    if (!state.report) return;
    this.renderHeader(state.report);
    this.renderTiers(state);
    this.renderArchitecture(state.report);
    this.renderIntegrity(state.report);
    this.renderMediaGallery(state);
  }

  private renderHeader(report: ProofReport): void {
    const badge = this.querySelector('[data-testid="proofs-overall-badge"]');
    if (badge) {
      applyStatusPillStyle(badge, report.overallStatus);
      badge.textContent =
        report.overallStatus === 'passed'
          ? 'All 4 Tiers Verified'
          : 'Verification Failed';
    }

    const commitEl = this.querySelector('[data-testid="proofs-meta-commit"]');
    if (commitEl) {
      commitEl.textContent = `${report.build.branch} @ ${report.build.shortCommit} (${report.build.nodeVersion})`;
    }

    const timeEl = this.querySelector('[data-testid="proofs-meta-time"]');
    if (timeEl) {
      timeEl.textContent = `Generated ${new Date(report.build.generatedAt).toUTCString()}`;
    }

    this.configureLink(
      '[data-testid="proofs-commit-link"]',
      report.build.commitUrl
    );
    this.configureLink('[data-testid="proofs-ci-link"]', report.build.runUrl);
    this.configureLink(
      '[data-testid="proofs-playwright-report-link"]',
      report.build.playwrightReportUrl
    );

    const passedEl = this.querySelector('[data-testid="proofs-kpi-passed"]');
    if (passedEl) {
      passedEl.textContent = `${report.totalPassed} / ${report.totalPassed + report.totalFailed}`;
    }

    const rateEl = this.querySelector('[data-testid="proofs-kpi-rate"]');
    if (rateEl) {
      rateEl.textContent = `${selectOverallPassRate(report)}%`;
    }

    const archEl = this.querySelector('[data-testid="proofs-kpi-arch"]');
    if (archEl) {
      archEl.textContent = `${report.architecture.totalModules}m · ${report.architecture.cycles} cycles`;
    }

    const durEl = this.querySelector('[data-testid="proofs-kpi-duration"]');
    if (durEl) {
      durEl.textContent = formatDuration(report.totalDurationMs);
    }
  }

  private configureLink(selector: string, href: string): void {
    const link = this.querySelector(selector);
    if (!(link instanceof HTMLAnchorElement)) return;
    if (href.length > 0) {
      link.setAttribute('href', href);
      link.classList.remove('hidden');
    } else {
      link.classList.add('hidden');
    }
  }

  private renderTierFilterButtons(selectedTier: string): void {
    this.querySelectorAll('[data-tier-filter]').forEach((btn) => {
      const isActive = btn.getAttribute('data-tier-filter') === selectedTier;
      btn.classList.toggle('bg-slate-900', isActive);
      btn.classList.toggle('dark:bg-slate-100', isActive);
      btn.classList.toggle('text-white', isActive);
      btn.classList.toggle('dark:text-slate-900', isActive);
      btn.classList.toggle('shadow-sm', isActive);
      btn.classList.toggle('text-slate-600', !isActive);
      btn.classList.toggle('dark:text-slate-300', !isActive);
    });
  }

  private renderTiers(state: ProofDashboardState): void {
    const container = this.querySelector(
      '[data-testid="proofs-tiers-container"]'
    );
    const tierTpl = this.querySelector('#proof-tier-template');
    const checkTpl = this.querySelector('#proof-check-template');
    if (
      !container ||
      !(tierTpl instanceof HTMLTemplateElement) ||
      !(checkTpl instanceof HTMLTemplateElement)
    ) {
      return;
    }

    const visibleTiers = selectVisibleTiers(state);
    if (visibleTiers.length === 0) {
      const empty = document.createElement('p');
      empty.className =
        'text-sm text-slate-500 dark:text-slate-400 text-center py-8 bg-[var(--boba-surface)] rounded-2xl border border-slate-200 dark:border-slate-800';
      empty.textContent = 'No verification checks match the current filter.';
      container.replaceChildren(empty);
      return;
    }

    const nodes = visibleTiers.map((tier) => {
      const frag = document.importNode(tierTpl.content, true);
      const numEl = frag.querySelector('.tier-number');
      const statusEl = frag.querySelector('.tier-status');
      const titleEl = frag.querySelector('.tier-title');
      const subtitleEl = frag.querySelector('.tier-subtitle');
      const countsEl = frag.querySelector('.tier-counts');
      const durationEl = frag.querySelector('.tier-duration');
      const checksContainer = frag.querySelector('.tier-checks');

      if (numEl) numEl.textContent = `Tier ${tier.tier}`;
      if (statusEl) applyStatusPillStyle(statusEl, tier.status);
      if (titleEl) titleEl.textContent = tier.title;
      if (subtitleEl) subtitleEl.textContent = tier.subtitle;
      if (countsEl) {
        countsEl.textContent = `${tier.passedCount} passed · ${tier.failedCount} failed · ${tier.skippedCount} skipped`;
      }
      if (durationEl) durationEl.textContent = formatDuration(tier.durationMs);

      if (checksContainer) {
        const checkNodes = tier.checks.map((check) => {
          const checkFrag = document.importNode(checkTpl.content, true);
          const cStatus = checkFrag.querySelector('.check-status');
          const cName = checkFrag.querySelector('.check-name');
          const cDur = checkFrag.querySelector('.check-duration');
          const cSum = checkFrag.querySelector('.check-summary');
          const cCmd = checkFrag.querySelector('.check-command');
          const detailsBox = checkFrag.querySelector('.check-details-box');
          const detailsList = checkFrag.querySelector('.check-details-list');

          if (cStatus) applyStatusPillStyle(cStatus, check.status);
          if (cName) cName.textContent = check.name;
          if (cDur) cDur.textContent = formatDuration(check.durationMs);
          if (cSum) cSum.textContent = check.summary;
          if (cCmd) cCmd.textContent = `$ ${check.command}`;

          if (detailsBox && detailsList && check.details.length > 0) {
            detailsBox.classList.remove('hidden');
            const summaryEl = detailsBox.querySelector('summary');
            if (summaryEl) {
              summaryEl.textContent = `Verified items (${check.details.length})`;
            }
            const items = check.details.map((line) => {
              const li = document.createElement('li');
              li.textContent = line;
              return li;
            });
            detailsList.replaceChildren(...items);
          }
          return checkFrag;
        });
        checksContainer.replaceChildren(...checkNodes);
      }

      return frag;
    });

    container.replaceChildren(...nodes);
  }

  private renderArchitecture(report: ProofReport): void {
    const cyclesEl = this.querySelector('[data-testid="proofs-arch-cycles"]');
    if (cyclesEl) {
      cyclesEl.textContent = `${report.architecture.cycles} circular dependencies · ${report.architecture.violations} violations`;
    }

    const tbody = this.querySelector('[data-testid="proofs-arch-tbody"]');
    if (!tbody) return;

    const rows = report.architecture.layers.map((layer) => {
      const tr = document.createElement('tr');
      const cells = [
        { text: layer.layer, cls: 'py-3 pr-4 font-semibold' },
        { text: layer.directory, cls: 'py-3 pr-4 font-mono text-xs' },
        {
          text: layer.purpose,
          cls: 'py-3 pr-4 text-slate-600 dark:text-slate-300',
        },
        {
          text: layer.allowedImports,
          cls: 'py-3 pr-4 font-mono text-xs text-slate-600 dark:text-slate-400',
        },
        {
          text: `${layer.moduleCount} / ${layer.edgeCount}`,
          cls: 'py-3 text-right font-mono text-xs font-semibold',
        },
      ];
      for (const cell of cells) {
        const td = document.createElement('td');
        td.className = cell.cls;
        td.textContent = cell.text;
        tr.appendChild(td);
      }
      return tr;
    });
    tbody.replaceChildren(...rows);
  }

  private renderIntegrity(report: ProofReport): void {
    const { integrity } = report;
    const intact =
      integrity.status === 'intact' && integrity.changelogChainValid;

    const sealBadge = this.querySelector('[data-testid="proofs-seal-badge"]');
    if (sealBadge) {
      applyStatusPillStyle(sealBadge, intact ? 'passed' : 'failed');
      sealBadge.textContent = intact ? 'SEAL INTACT' : 'TAMPER DETECTED';
    }

    const rootEl = this.querySelector('[data-testid="proofs-seal-root"]');
    if (rootEl) {
      rootEl.textContent = integrity.rootSha256 || 'Not sealed';
    }

    const zonesEl = this.querySelector('[data-testid="proofs-seal-zones"]');
    if (zonesEl) {
      zonesEl.textContent = `${integrity.harnessFileCount} harness · ${integrity.testFileCount} tests`;
    }

    const floorsEl = this.querySelector('[data-testid="proofs-seal-floors"]');
    if (floorsEl) {
      const f = integrity.metricFloors;
      floorsEl.textContent = `≥${f.minUnitTests}u · ≥${f.minPropertyTests}p · ≥${f.minE2ETests}e · ≤${f.maxSkippedTests} skip`;
    }

    const filesSummary = this.querySelector(
      '[data-testid="proofs-locked-files-summary"]'
    );
    if (filesSummary) {
      filesSummary.textContent = `SHA-256 Locked Verification Files (${integrity.lockedFiles.length})`;
    }

    const filesTbody = this.querySelector(
      '[data-testid="proofs-locked-files-tbody"]'
    );
    if (filesTbody) {
      const fileRows = integrity.lockedFiles.map((file) => {
        const tr = document.createElement('tr');
        const zoneTd = document.createElement('td');
        zoneTd.className = 'py-2 pr-3 font-semibold uppercase';
        zoneTd.textContent = file.zone;
        const pathTd = document.createElement('td');
        pathTd.className = 'py-2 pr-3 text-slate-700 dark:text-slate-200';
        pathTd.textContent = file.path;
        const hashTd = document.createElement('td');
        hashTd.className = 'py-2 text-slate-500 dark:text-slate-400 break-all';
        hashTd.textContent = file.sha256;
        tr.append(zoneTd, pathTd, hashTd);
        return tr;
      });
      filesTbody.replaceChildren(...fileRows);
    }

    const changelogBadge = this.querySelector(
      '[data-testid="proofs-changelog-badge"]'
    );
    if (changelogBadge) {
      applyStatusPillStyle(
        changelogBadge,
        integrity.changelogChainValid ? 'passed' : 'failed'
      );
      changelogBadge.textContent = integrity.changelogChainValid
        ? `Chain Valid (${integrity.changelogEntries.length})`
        : 'Chain Broken';
    }

    const changelogTbody = this.querySelector(
      '[data-testid="proofs-changelog-tbody"]'
    );
    if (changelogTbody) {
      const entries = [...integrity.changelogEntries].reverse();
      if (entries.length === 0) {
        const tr = document.createElement('tr');
        const td = document.createElement('td');
        td.setAttribute('colspan', '5');
        td.className = 'py-3 text-slate-500 dark:text-slate-400';
        td.textContent = 'No attested changelog entries recorded yet.';
        tr.appendChild(td);
        changelogTbody.replaceChildren(tr);
      } else {
        const rows = entries.map((entry) => {
          const tr = document.createElement('tr');
          const cells = [
            { text: entry.commit, cls: 'py-2.5 pr-3 font-mono font-semibold' },
            { text: entry.verdict, cls: 'py-2.5 pr-3 font-mono font-semibold' },
            {
              text: entry.summary,
              cls: 'py-2.5 pr-3 text-slate-700 dark:text-slate-300',
            },
            {
              text: `${entry.rootSha256.slice(0, 12)}…`,
              cls: 'py-2.5 pr-3 font-mono text-slate-500 dark:text-slate-400',
            },
            {
              text: `${entry.attestationSha256.slice(0, 12)}…`,
              cls: 'py-2.5 font-mono text-slate-500 dark:text-slate-400',
            },
          ];
          for (const cell of cells) {
            const td = document.createElement('td');
            td.className = cell.cls;
            td.textContent = cell.text;
            tr.appendChild(td);
          }
          return tr;
        });
        changelogTbody.replaceChildren(...rows);
      }
    }
  }

  private renderMediaGallery(state: ProofDashboardState): void {
    const filtersEl = this.querySelector(
      '[data-testid="proofs-project-filters"]'
    );
    const gridEl = this.querySelector('[data-testid="proofs-media-grid"]');
    const mediaTpl = this.querySelector('#proof-media-template');
    if (!filtersEl || !gridEl || !(mediaTpl instanceof HTMLTemplateElement)) {
      return;
    }

    const projects = ['all', ...selectAvailableProjects(state)];
    const buttons = projects.map((project) => {
      const btn = document.createElement('button');
      btn.setAttribute('data-project-filter', project);
      btn.setAttribute('data-testid', `proofs-project-${project}`);
      btn.textContent = project === 'all' ? 'All Projects' : project;
      const isActive = state.selectedProject === project;
      btn.className = isActive
        ? 'px-3 py-1 rounded-lg text-xs font-semibold bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 cursor-pointer'
        : 'px-3 py-1 rounded-lg text-xs font-semibold bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 cursor-pointer';
      return btn;
    });
    filtersEl.replaceChildren(...buttons);

    const visibleMedia = selectVisibleMedia(state);
    if (visibleMedia.length === 0) {
      const empty = document.createElement('p');
      empty.className =
        'text-sm text-slate-500 dark:text-slate-400 col-span-full py-4';
      empty.textContent = 'No Playwright proof runs match the current filter.';
      gridEl.replaceChildren(empty);
      return;
    }

    const cards = visibleMedia.map((item) => {
      const frag = document.importNode(mediaTpl.content, true);
      const projEl = frag.querySelector('.media-project');
      const statusEl = frag.querySelector('.media-status');
      const titleEl = frag.querySelector('.media-title');
      const fileEl = frag.querySelector('.media-file');
      const durEl = frag.querySelector('.media-duration');
      const videoWrap = frag.querySelector('.media-video-wrap');
      const videoEl = frag.querySelector('.media-video');
      const shotLink = frag.querySelector('.media-screenshot-link');
      const traceLink = frag.querySelector('.media-trace-link');

      if (projEl) projEl.textContent = item.project;
      if (statusEl) applyStatusPillStyle(statusEl, item.status);
      if (titleEl) titleEl.textContent = item.title;
      if (fileEl) fileEl.textContent = item.file;
      if (durEl) durEl.textContent = formatDuration(item.durationMs);

      if (
        item.videoPath.length > 0 &&
        videoWrap &&
        videoEl instanceof HTMLVideoElement
      ) {
        videoEl.setAttribute('src', item.videoPath);
        if (item.screenshotPath.length > 0) {
          videoEl.setAttribute('poster', item.screenshotPath);
        }
        videoWrap.classList.remove('hidden');
      }

      if (
        item.screenshotPath.length > 0 &&
        shotLink instanceof HTMLAnchorElement
      ) {
        shotLink.setAttribute('href', item.screenshotPath);
        shotLink.classList.remove('hidden');
      }

      if (item.tracePath.length > 0 && traceLink instanceof HTMLAnchorElement) {
        traceLink.setAttribute('href', item.tracePath);
        traceLink.classList.remove('hidden');
      }

      return frag;
    });
    gridEl.replaceChildren(...cards);
  }
}

if (!customElements.get(ProofsPageComponent.tagName)) {
  customElements.define(ProofsPageComponent.tagName, ProofsPageComponent);
}
