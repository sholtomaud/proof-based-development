import { BaseComponent } from '../../core/base-component.ts';
import { fetchProofReport } from '../../services/proof-report-service.ts';
import type { ProofReport } from '../../shared/proof-report.ts';
import template from './home-page.html?raw';
import style from './home-page.css?raw';

export class HomeComponent extends BaseComponent {
  static tagName = 'home-page';

  constructor() {
    super(template, style);
  }

  async init() {
    try {
      const report = await fetchProofReport();
      this.renderSummary(report);
    } catch {
      const badge = this.querySelector('[data-testid="home-proof-badge"]');
      if (badge) badge.textContent = 'Run npm run report to generate proofs';
    }
  }

  private renderSummary(report: ProofReport): void {
    const badge = this.querySelector('[data-testid="home-proof-badge"]');
    if (badge) {
      const passed = report.overallStatus === 'passed';
      badge.textContent = passed
        ? `Verified · ${report.totalPassed} checks passed`
        : `Failed · ${report.totalFailed} check(s) failed`;
      badge.className = passed
        ? 'inline-flex items-center px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300'
        : 'inline-flex items-center px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider bg-rose-100 dark:bg-rose-950/60 text-rose-800 dark:text-rose-300';
    }

    const meta = this.querySelector('[data-testid="home-proof-meta"]');
    if (meta) {
      meta.textContent = `${report.build.branch} @ ${report.build.shortCommit} · ${report.architecture.totalModules} modules · ${report.architecture.cycles} cycles`;
    }

    const pwLink = this.querySelector(
      '[data-testid="home-playwright-report-link"]'
    );
    if (
      pwLink instanceof HTMLAnchorElement &&
      report.build.playwrightReportUrl.length > 0
    ) {
      pwLink.setAttribute('href', report.build.playwrightReportUrl);
      pwLink.classList.remove('hidden');
    }

    const grid = this.querySelector('[data-testid="home-tier-summary-grid"]');
    const cardTpl = this.querySelector('#home-tier-card-template');
    if (!grid || !(cardTpl instanceof HTMLTemplateElement)) return;

    const cards = report.tiers.map((tier) => {
      const frag = document.importNode(cardTpl.content, true);
      const numEl = frag.querySelector('.home-tier-num');
      const statusEl = frag.querySelector('.home-tier-status');
      const titleEl = frag.querySelector('.home-tier-title');
      const subEl = frag.querySelector('.home-tier-subtitle');
      const countsEl = frag.querySelector('.home-tier-counts');

      if (numEl) numEl.textContent = `Tier ${tier.tier}`;
      if (statusEl) {
        statusEl.textContent = tier.status;
        statusEl.className =
          tier.status === 'passed'
            ? 'home-tier-status text-[11px] font-bold uppercase px-2.5 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300'
            : tier.status === 'failed'
              ? 'home-tier-status text-[11px] font-bold uppercase px-2.5 py-0.5 rounded-full bg-rose-100 dark:bg-rose-950/60 text-rose-800 dark:text-rose-300'
              : 'home-tier-status text-[11px] font-bold uppercase px-2.5 py-0.5 rounded-full bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300';
      }
      if (titleEl) titleEl.textContent = tier.title;
      if (subEl) subEl.textContent = tier.subtitle;
      if (countsEl) {
        countsEl.textContent = `${tier.passedCount} passed · ${tier.failedCount} failed · ${tier.durationMs}ms`;
      }
      return frag;
    });

    grid.replaceChildren(...cards);
  }
}

if (!customElements.get(HomeComponent.tagName)) {
  customElements.define(HomeComponent.tagName, HomeComponent);
}
