import { isRecord } from './contracts.ts';

export const PROOF_STATUSES = ['passed', 'failed', 'skipped'] as const;
export type ProofStatus = (typeof PROOF_STATUSES)[number];

export const PROOF_TIER_IDS = [
  'static',
  'architecture',
  'properties',
  'e2e',
] as const;
export type ProofTierId = (typeof PROOF_TIER_IDS)[number];

export const PROOF_LOCK_ZONES = ['harness', 'tests'] as const;
export type ProofLockZone = (typeof PROOF_LOCK_ZONES)[number];

export interface ProofBuildInfo {
  readonly commit: string;
  readonly shortCommit: string;
  readonly branch: string;
  readonly generatedAt: string;
  readonly nodeVersion: string;
  readonly commitUrl: string;
  readonly runUrl: string;
  readonly repoUrl: string;
  readonly playwrightReportUrl: string;
}

export interface ProofCheckItem {
  readonly id: string;
  readonly name: string;
  readonly status: ProofStatus;
  readonly durationMs: number;
  readonly summary: string;
  readonly command: string;
  readonly details: readonly string[];
}

export interface ProofTier {
  readonly tier: 1 | 2 | 3 | 4;
  readonly id: ProofTierId;
  readonly title: string;
  readonly subtitle: string;
  readonly status: ProofStatus;
  readonly passedCount: number;
  readonly failedCount: number;
  readonly skippedCount: number;
  readonly durationMs: number;
  readonly checks: readonly ProofCheckItem[];
}

export interface BoundaryLayerInfo {
  readonly layer: string;
  readonly directory: string;
  readonly purpose: string;
  readonly allowedImports: string;
  readonly moduleCount: number;
  readonly edgeCount: number;
}

export interface ArchitectureReport {
  readonly totalModules: number;
  readonly totalEdges: number;
  readonly cycles: number;
  readonly violations: number;
  readonly layers: readonly BoundaryLayerInfo[];
  readonly rules: readonly string[];
}

export interface ProofE2EMediaItem {
  readonly id: string;
  readonly title: string;
  readonly project: string;
  readonly file: string;
  readonly status: ProofStatus;
  readonly durationMs: number;
  readonly videoPath: string;
  readonly screenshotPath: string;
  readonly tracePath: string;
}

export interface LockedFileEntry {
  readonly path: string;
  readonly zone: ProofLockZone;
  readonly sha256: string;
}

export interface MetricFloors {
  readonly minUnitTests: number;
  readonly minPropertyTests: number;
  readonly minE2ETests: number;
  readonly minArchRules: number;
  readonly maxSkippedTests: number;
}

export interface ProofChangelogEntry {
  readonly commit: string;
  readonly timestamp: string;
  readonly rootSha256: string;
  readonly summary: string;
  readonly verdict: string;
  readonly previousAttestation: string;
  readonly attestationSha256: string;
}

export interface ProofIntegrityReport {
  readonly status: 'intact' | 'tampered';
  readonly rootSha256: string;
  readonly harnessFileCount: number;
  readonly testFileCount: number;
  readonly metricFloors: MetricFloors;
  readonly lockedFiles: readonly LockedFileEntry[];
  readonly changelogChainValid: boolean;
  readonly changelogEntries: readonly ProofChangelogEntry[];
}

export interface ProofReport {
  readonly schemaVersion: 1;
  readonly overallStatus: ProofStatus;
  readonly totalPassed: number;
  readonly totalFailed: number;
  readonly totalSkipped: number;
  readonly totalDurationMs: number;
  readonly build: ProofBuildInfo;
  readonly tiers: readonly ProofTier[];
  readonly architecture: ArchitectureReport;
  readonly e2eMedia: readonly ProofE2EMediaItem[];
  readonly integrity: ProofIntegrityReport;
}

export function isProofStatus(value: unknown): value is ProofStatus {
  return (
    typeof value === 'string' &&
    PROOF_STATUSES.some((status) => status === value)
  );
}

export function isProofTierId(value: unknown): value is ProofTierId {
  return typeof value === 'string' && PROOF_TIER_IDS.some((id) => id === value);
}

export function isProofLockZone(value: unknown): value is ProofLockZone {
  return (
    typeof value === 'string' && PROOF_LOCK_ZONES.some((zone) => zone === value)
  );
}

function isStringArray(value: unknown): value is readonly string[] {
  return (
    Array.isArray(value) && value.every((entry) => typeof entry === 'string')
  );
}

function isNonNegativeNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function isProofBuildInfo(value: unknown): value is ProofBuildInfo {
  if (!isRecord(value)) return false;
  return (
    typeof value.commit === 'string' &&
    typeof value.shortCommit === 'string' &&
    typeof value.branch === 'string' &&
    typeof value.generatedAt === 'string' &&
    typeof value.nodeVersion === 'string' &&
    typeof value.commitUrl === 'string' &&
    typeof value.runUrl === 'string' &&
    typeof value.repoUrl === 'string' &&
    typeof value.playwrightReportUrl === 'string'
  );
}

function isProofCheckItem(value: unknown): value is ProofCheckItem {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === 'string' &&
    typeof value.name === 'string' &&
    isProofStatus(value.status) &&
    isNonNegativeNumber(value.durationMs) &&
    typeof value.summary === 'string' &&
    typeof value.command === 'string' &&
    isStringArray(value.details)
  );
}

function isTierNumber(value: unknown): value is 1 | 2 | 3 | 4 {
  return value === 1 || value === 2 || value === 3 || value === 4;
}

function isProofTier(value: unknown): value is ProofTier {
  if (!isRecord(value)) return false;
  return (
    isTierNumber(value.tier) &&
    isProofTierId(value.id) &&
    typeof value.title === 'string' &&
    typeof value.subtitle === 'string' &&
    isProofStatus(value.status) &&
    isNonNegativeNumber(value.passedCount) &&
    isNonNegativeNumber(value.failedCount) &&
    isNonNegativeNumber(value.skippedCount) &&
    isNonNegativeNumber(value.durationMs) &&
    Array.isArray(value.checks) &&
    value.checks.every(isProofCheckItem)
  );
}

function isBoundaryLayerInfo(value: unknown): value is BoundaryLayerInfo {
  if (!isRecord(value)) return false;
  return (
    typeof value.layer === 'string' &&
    typeof value.directory === 'string' &&
    typeof value.purpose === 'string' &&
    typeof value.allowedImports === 'string' &&
    isNonNegativeNumber(value.moduleCount) &&
    isNonNegativeNumber(value.edgeCount)
  );
}

function isArchitectureReport(value: unknown): value is ArchitectureReport {
  if (!isRecord(value)) return false;
  return (
    isNonNegativeNumber(value.totalModules) &&
    isNonNegativeNumber(value.totalEdges) &&
    isNonNegativeNumber(value.cycles) &&
    isNonNegativeNumber(value.violations) &&
    Array.isArray(value.layers) &&
    value.layers.every(isBoundaryLayerInfo) &&
    isStringArray(value.rules)
  );
}

function isProofE2EMediaItem(value: unknown): value is ProofE2EMediaItem {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === 'string' &&
    typeof value.title === 'string' &&
    typeof value.project === 'string' &&
    typeof value.file === 'string' &&
    isProofStatus(value.status) &&
    isNonNegativeNumber(value.durationMs) &&
    typeof value.videoPath === 'string' &&
    typeof value.screenshotPath === 'string' &&
    typeof value.tracePath === 'string'
  );
}

export function isLockedFileEntry(value: unknown): value is LockedFileEntry {
  if (!isRecord(value)) return false;
  return (
    typeof value.path === 'string' &&
    isProofLockZone(value.zone) &&
    typeof value.sha256 === 'string'
  );
}

export function isMetricFloors(value: unknown): value is MetricFloors {
  if (!isRecord(value)) return false;
  return (
    isNonNegativeNumber(value.minUnitTests) &&
    isNonNegativeNumber(value.minPropertyTests) &&
    isNonNegativeNumber(value.minE2ETests) &&
    isNonNegativeNumber(value.minArchRules) &&
    isNonNegativeNumber(value.maxSkippedTests)
  );
}

export function isProofChangelogEntry(
  value: unknown
): value is ProofChangelogEntry {
  if (!isRecord(value)) return false;
  return (
    typeof value.commit === 'string' &&
    typeof value.timestamp === 'string' &&
    typeof value.rootSha256 === 'string' &&
    typeof value.summary === 'string' &&
    typeof value.verdict === 'string' &&
    typeof value.previousAttestation === 'string' &&
    typeof value.attestationSha256 === 'string'
  );
}

function isProofIntegrityReport(value: unknown): value is ProofIntegrityReport {
  if (!isRecord(value)) return false;
  return (
    (value.status === 'intact' || value.status === 'tampered') &&
    typeof value.rootSha256 === 'string' &&
    isNonNegativeNumber(value.harnessFileCount) &&
    isNonNegativeNumber(value.testFileCount) &&
    isMetricFloors(value.metricFloors) &&
    Array.isArray(value.lockedFiles) &&
    value.lockedFiles.every(isLockedFileEntry) &&
    typeof value.changelogChainValid === 'boolean' &&
    Array.isArray(value.changelogEntries) &&
    value.changelogEntries.every(isProofChangelogEntry)
  );
}

export function isProofReport(value: unknown): value is ProofReport {
  if (!isRecord(value)) return false;
  return (
    value.schemaVersion === 1 &&
    isProofStatus(value.overallStatus) &&
    isNonNegativeNumber(value.totalPassed) &&
    isNonNegativeNumber(value.totalFailed) &&
    isNonNegativeNumber(value.totalSkipped) &&
    isNonNegativeNumber(value.totalDurationMs) &&
    isProofBuildInfo(value.build) &&
    Array.isArray(value.tiers) &&
    value.tiers.every(isProofTier) &&
    isArchitectureReport(value.architecture) &&
    Array.isArray(value.e2eMedia) &&
    value.e2eMedia.every(isProofE2EMediaItem) &&
    isProofIntegrityReport(value.integrity)
  );
}
