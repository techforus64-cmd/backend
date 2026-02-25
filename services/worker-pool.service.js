/**
 * Worker Pool Service
 * Manages a pool of worker threads for parallel vendor calculations
 * PERFORMANCE: 8 workers = 8X CPU parallelization
 */

import { Worker } from 'worker_threads';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class WorkerPool {
    constructor(size = 8) {
        this.workerCount = size;
        this.workers = [];
        this.activeJobs = 0;
        this.stats = {
            totalJobs: 0,
            totalVendors: 0,
            totalDuration: 0,
            errors: 0
        };

        // Initialize worker pool
        for (let i = 0; i < size; i++) {
            this.createWorker(i);
        }

        console.log(`[WorkerPool] Initialized with ${size} workers`);
    }

    createWorker(id) {
        const worker = new Worker(path.join(__dirname, '../workers/vendor-calculator.worker.js'));

        worker.on('error', (error) => {
            console.error(`[WorkerPool] Worker ${id} error:`, error);
            this.stats.errors++;

            // Recreate worker on error
            setTimeout(() => {
                console.log(`[WorkerPool] Recreating worker ${id}`);
                this.workers[id] = this.createWorker(id);
            }, 1000);
        });

        worker.on('exit', (code) => {
            if (code !== 0) {
                console.error(`[WorkerPool] Worker ${id} exited with code ${code}`);
            }
        });

        this.workers[id] = {
            worker,
            id,
            busy: false
        };

        return this.workers[id];
    }

    /**
     * Execute vendor calculations across worker pool
     * @param {Array} vendors - All vendors to calculate
     * @param {Object} context - Calculation context (route, shipment, etc)
     * @returns {Promise<Array>} Calculated vendor results
     */
    async execute(vendors, context) {
        const startTime = Date.now();
        this.activeJobs++;
        this.stats.totalJobs++;
        this.stats.totalVendors += vendors.length;

        try {
            // Split vendors into chunks for each worker
            const chunks = this.chunkArray(vendors, this.workerCount);

            // Process all chunks in parallel
            const results = await Promise.all(
                chunks.map((chunk, i) => this.runOnWorker(i, chunk, context))
            );

            // Flatten results
            const allResults = results.flatMap(r => r.results);

            // Collect stats
            const totalDuration = Date.now() - startTime;
            this.stats.totalDuration += totalDuration;

            const avgPerVendor = totalDuration / vendors.length;

            console.log(
                `[WorkerPool] Processed ${vendors.length} vendors in ${totalDuration}ms ` +
                `(${avgPerVendor.toFixed(1)}ms/vendor, ` +
                `${this.workerCount} workers)`
            );

            return allResults;
        } catch (error) {
            console.error('[WorkerPool] Execution error:', error);
            this.stats.errors++;
            throw error;
        } finally {
            this.activeJobs--;
        }
    }

    /**
     * Run calculation on a specific worker
     */
    runOnWorker(workerIndex, vendors, context) {
        return new Promise((resolve, reject) => {
            if (!this.workers[workerIndex]) {
                return reject(new Error(`Worker ${workerIndex} not available`));
            }

            const workerObj = this.workers[workerIndex];
            const worker = workerObj.worker;

            workerObj.busy = true;

            // Set timeout for worker response
            const timeout = setTimeout(() => {
                reject(new Error(`Worker ${workerIndex} timeout after 10s`));
            }, 10000);

            worker.once('message', (response) => {
                clearTimeout(timeout);
                workerObj.busy = false;
                resolve(response);
            });

            worker.once('error', (error) => {
                clearTimeout(timeout);
                workerObj.busy = false;
                reject(error);
            });

            // Send work to worker
            worker.postMessage({ vendors, context });
        });
    }

    /**
     * Split array into N chunks for parallel processing
     */
    chunkArray(array, chunks) {
        if (array.length === 0) return [];

        const result = [];
        const chunkSize = Math.ceil(array.length / chunks);

        for (let i = 0; i < array.length; i += chunkSize) {
            result.push(array.slice(i, i + chunkSize));
        }

        return result;
    }

    /**
     * Get pool statistics
     */
    getStats() {
        return {
            ...this.stats,
            workers: this.workerCount,
            activeJobs: this.activeJobs,
            avgDurationPerJob: this.stats.totalJobs > 0
                ? (this.stats.totalDuration / this.stats.totalJobs).toFixed(0)
                : 0,
            avgDurationPerVendor: this.stats.totalVendors > 0
                ? (this.stats.totalDuration / this.stats.totalVendors).toFixed(1)
                : 0
        };
    }

    /**
     * Shutdown all workers gracefully
     */
    async shutdown() {
        console.log('[WorkerPool] Shutting down...');

        await Promise.all(
            this.workers.map(w => w.worker.terminate())
        );

        console.log('[WorkerPool] All workers terminated');
    }
}

// Create singleton instance with 8 workers for 1-2s target
const workerPool = new WorkerPool(8);

// Graceful shutdown on process termination
process.on('SIGTERM', async () => {
    await workerPool.shutdown();
    process.exit(0);
});

process.on('SIGINT', async () => {
    await workerPool.shutdown();
    process.exit(0);
});

export default workerPool;
