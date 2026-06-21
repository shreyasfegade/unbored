import api from './client';

export interface LlmStatus {
  configured: boolean;
  provider: string | null;
  model: string | null;
  label: string;
}

export interface AppStatus {
  catalogMode: 'live' | 'demo';
  catalogSize: number;
  llm: LlmStatus;
}

interface StatusResponse {
  catalog: { mode: 'live' | 'demo'; size: number; tmdb_genres_loaded: boolean };
  llm: LlmStatus;
}

export async function getStatus(): Promise<AppStatus> {
  const { data } = await api.get<StatusResponse>('/api/status');
  return {
    catalogMode: data.catalog.mode,
    catalogSize: data.catalog.size,
    llm: data.llm,
  };
}
