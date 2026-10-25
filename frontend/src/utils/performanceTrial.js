// Build-time escape hatch. Reverting the trial PR restores the complete baseline;
// this flag independently disables trial image/data/prefetch paths in a new build.
export const PERFORMANCE_TRIAL_ENABLED = String(import.meta.env.VITE_PERFORMANCE_TRIAL ?? '1') !== '0'
