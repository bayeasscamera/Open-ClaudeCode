import { logError } from './log.js'

// ---------------------------------------------------------------------------
// Circuit Breaker
// ---------------------------------------------------------------------------

type CircuitState = 'closed' | 'open' | 'half-open'

interface CircuitBreakerOptions {
  failureThreshold?: number
  resetTimeoutMs?: number
  halfOpenMaxCalls?: number
}

export class CircuitBreakerOpenError extends Error {
  constructor(public readonly lastError?: unknown) {
    super('Circuit breaker is open')
    this.name = 'CircuitBreakerOpenError'
  }
}

export class CircuitBreaker {
  private state: CircuitState = 'closed'
  private consecutiveFailures = 0
  private lastFailureTime = 0
  private halfOpenCalls = 0

  private readonly failureThreshold: number
  private readonly resetTimeoutMs: number
  private readonly halfOpenMaxCalls: number

  constructor(options: CircuitBreakerOptions = {}) {
    this.failureThreshold = options.failureThreshold ?? 5
    this.resetTimeoutMs = options.resetTimeoutMs ?? 30_000
    this.halfOpenMaxCalls = options.halfOpenMaxCalls ?? 1
  }

  getState(): CircuitState {
    if (this.state === 'open') {
      if (Date.now() - this.lastFailureTime >= this.resetTimeoutMs) {
        this.state = 'half-open'
        this.halfOpenCalls = 0
      }
    }
    return this.state
  }

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    const currentState = this.getState()

    if (currentState === 'open') {
      throw new CircuitBreakerOpenError()
    }

    if (currentState === 'half-open') {
      if (this.halfOpenCalls >= this.halfOpenMaxCalls) {
        throw new CircuitBreakerOpenError()
      }
      this.halfOpenCalls++
    }

    try {
      const result = await fn()
      this.onSuccess()
      return result
    } catch (error) {
      this.onFailure()
      throw error
    }
  }

  private onSuccess(): void {
    this.consecutiveFailures = 0
    if (this.state === 'half-open') {
      this.state = 'closed'
      this.halfOpenCalls = 0
    }
  }

  private onFailure(): void {
    this.consecutiveFailures++
    this.lastFailureTime = Date.now()
    if (this.consecutiveFailures >= this.failureThreshold) {
      this.state = 'open'
    }
  }
}

// ---------------------------------------------------------------------------
// Offline Queue
// ---------------------------------------------------------------------------

interface QueuedRequest {
  id: string
  execute: () => Promise<unknown>
  retries: number
  maxRetries: number
}

/**
 * Simple in-memory offline request queue.
 * In a desktop/Electron context, this can be extended to persist
 * to localStorage or a temp file.
 */
export class OfflineQueue {
  private queue: QueuedRequest[] = []
  private flushing = false

  enqueue(request: QueuedRequest): void {
    this.queue.push(request)
  }

  size(): number {
    return this.queue.length
  }

  clear(): void {
    this.queue = []
  }

  async flush(): Promise<void> {
    if (this.flushing || this.queue.length === 0) return
    this.flushing = true

    const snapshot = [...this.queue]
    this.queue = []

    for (const req of snapshot) {
      try {
        await req.execute()
      } catch (error) {
        logError(error)
        // Re-enqueue if retries remain
        if (req.retries < req.maxRetries) {
          this.enqueue({ ...req, retries: req.retries + 1 })
        }
      }
    }

    this.flushing = false
  }
}
