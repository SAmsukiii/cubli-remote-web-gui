export const createAnalysisWorker=()=>new Worker(new URL('./analysis.worker.js',import.meta.url));
