/**
 * Errors and the one network helper the app still needs.
 *
 * Catalog reads, search and recommendations all run in the browser now (see
 * src/engine), so the network is only used for the optional AI functions under
 * /api/ai. Every failure, local or remote, surfaces as an ApiError with a
 * stable code, so callers never substring-match prose to decide what happened.
 */
import { PackError } from "../engine/pack";

export type ApiErrorCode =
  | 'TIMEOUT'
  | 'NETWORK'
  | 'NOT_FOUND'
  | 'SERVER'
  | 'VALIDATION'
  | 'RATE_LIMITED'
  | 'CANCELED'
  | 'CATALOG'
  | 'UNKNOWN';

export interface ApiError extends Error {
  code: ApiErrorCode;
  status?: number;
  serverErrorCode?: string;
}

export function apiError(code: ApiErrorCode, message: string, status?: number): ApiError {
  const err = new Error(message) as ApiError;
  err.code = code;
  if (status !== undefined) err.status = status;
  return err;
}

/** Map anything thrown by the local engine or catalog into an ApiError. */
export function toApiError(err: unknown): ApiError {
  if ((err as ApiError)?.code) return err as ApiError;
  if (err instanceof PackError) return apiError('CATALOG', err.message);
  if ((err as Error)?.name === 'AbortError') return apiError('CANCELED', 'Request canceled');
  return apiError('UNKNOWN', (err as Error)?.message || 'Something went wrong.');
}

/** A user-facing sentence for an error, chosen by its stable code. */
export function describeApiError(err: unknown): string {
  const code = (err as ApiError | undefined)?.code;
  switch (code) {
    case 'CATALOG':
      return "Couldn't load the catalog. Check your connection and try again.";
    case 'TIMEOUT':
      return 'That took too long. Try again.';
    case 'NETWORK':
      return "Can't reach the network. Check your connection.";
    case 'RATE_LIMITED':
      return 'Too many requests for now. Give it a minute.';
    case 'SERVER':
      return 'The server hit a problem. Give it another try.';
    case 'NOT_FOUND':
      return "That title isn't in the catalog.";
    default:
      return 'Something went wrong. Try again.';
  }
}

export function isCanceled(err: unknown): boolean {
  return (err as ApiError | undefined)?.code === 'CANCELED';
}

interface RequestOptions {
  body?: unknown;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  timeoutMs?: number;
}

/** JSON over fetch with a timeout, classified errors, and `{ data }` results. */
export async function request<T>(method: 'GET' | 'POST', url: string, opts: RequestOptions = {}): Promise<{ data: T }> {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, opts.timeoutMs ?? 15000);
  const onAbort = () => controller.abort();
  opts.signal?.addEventListener('abort', onAbort);

  let res: Response;
  try {
    res = await fetch((import.meta.env.VITE_API_BASE_URL || '') + url, {
      method,
      headers: { 'Content-Type': 'application/json', ...opts.headers },
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      signal: controller.signal,
    });
  } catch {
    if (opts.signal?.aborted) throw apiError('CANCELED', 'Request canceled');
    throw timedOut ? apiError('TIMEOUT', 'The request took too long.') : apiError('NETWORK', "Can't reach the network.");
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener('abort', onAbort);
  }

  const data: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const detail = (data as { detail?: string; error_code?: string } | null) ?? {};
    const err = apiError(
      res.status === 404 ? 'NOT_FOUND'
        : res.status === 422 || res.status === 400 ? 'VALIDATION'
        : res.status === 429 ? 'RATE_LIMITED'
        : res.status >= 500 ? 'SERVER'
        : 'UNKNOWN',
      typeof detail.detail === 'string' && detail.detail ? detail.detail : 'Request failed',
      res.status,
    );
    err.serverErrorCode = detail.error_code;
    throw err;
  }
  return { data: data as T };
}
