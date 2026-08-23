import axios, { type InternalAxiosRequestConfig } from 'axios';
import { useLlmStore } from '../stores/llmStore';

// The backend runs on a free tier that cold-starts in ~45s after idle. A 30s
// timeout guaranteed a failure on the first request; 90s lets it wake up.
const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || '',
  timeout: 90000,
  headers: { 'Content-Type': 'application/json' },
});

/** Endpoints that actually need the user's LLM key. The key is NOT attached to
 *  search, taste, or health calls — no reason to send a secret where it's unused. */
function needsLlmKey(url: string | undefined): boolean {
  if (!url) return false;
  return url.includes('/api/recommend') || url.includes('/api/llm/');
}

api.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  if (!needsLlmKey(config.url)) return config;
  const { provider, apiKey, validated } = useLlmStore.getState();
  if (provider && apiKey && validated) {
    config.headers.set('X-LLM-Provider', provider);
    config.headers.set('X-LLM-Key', apiKey);
  }
  return config;
});

/** A stable, machine-readable classification so callers never have to
 *  substring-match human-readable prose to decide what went wrong. */
export type ApiErrorCode =
  | 'TIMEOUT'
  | 'NETWORK'
  | 'NOT_FOUND'
  | 'SERVER'
  | 'VALIDATION'
  | 'CANCELED'
  | 'UNKNOWN';

export interface ApiError extends Error {
  code: ApiErrorCode;
  status?: number;
  serverErrorCode?: string;
}

/** A user-facing sentence for an error, chosen by its stable code rather than
 *  by substring-matching the message — so a backend copy edit can never change
 *  what the user is told. */
export function describeApiError(err: unknown): string {
  const code = (err as ApiError | undefined)?.code;
  switch (code) {
    case 'TIMEOUT':
      return 'The server was waking up — that first request can take up to a minute. Try again.';
    case 'NETWORK':
      return "Can't reach the server. Check your connection.";
    case 'SERVER':
      return 'The server hit a problem. Give it another try.';
    default:
      return 'Something went wrong. Try again.';
  }
}

export function isCanceled(err: unknown): boolean {
  return (err as ApiError | undefined)?.code === 'CANCELED';
}

function classify(error: unknown): ApiError {
  const e = error as {
    code?: string;
    name?: string;
    message?: string;
    response?: { status?: number; data?: { detail?: string; error_code?: string } };
  };

  // Request was aborted (a newer request superseded it) — not a real failure.
  if (e.code === 'ERR_CANCELED' || e.name === 'CanceledError') {
    const err = new Error('Request canceled') as ApiError;
    err.code = 'CANCELED';
    return err;
  }

  // Timeout / network failures never have a response.
  if (!e.response) {
    const isTimeout = e.code === 'ECONNABORTED' || /timeout/i.test(e.message || '');
    const err = new Error(
      isTimeout
        ? 'The server took too long to respond.'
        : "Can't reach the server."
    ) as ApiError;
    err.code = isTimeout ? 'TIMEOUT' : 'NETWORK';
    return err;
  }

  const status = e.response.status;
  const detail = e.response.data?.detail;
  const err = new Error(typeof detail === 'string' && detail ? detail : 'Request failed') as ApiError;
  err.status = status;
  err.serverErrorCode = e.response.data?.error_code;
  if (status === 404) err.code = 'NOT_FOUND';
  else if (status === 422) err.code = 'VALIDATION';
  else if (status && status >= 500) err.code = 'SERVER';
  else err.code = 'UNKNOWN';
  return err;
}

api.interceptors.response.use(
  (response) => response,
  (error) => Promise.reject(classify(error))
);

export default api;
