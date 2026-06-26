import axios from 'axios';
import { useLlmStore } from '../stores/llmStore';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || '',
  timeout: 30000,
  headers: { 'Content-Type': 'application/json' },
});

// Attach the user's own LLM key (if connected) to every request. The key lives
// only in this browser and is sent over HTTPS; the server never stores it.
api.interceptors.request.use((config) => {
  const { provider, apiKey, validated } = useLlmStore.getState();
  if (provider && apiKey && validated) {
    config.headers['X-LLM-Provider'] = provider;
    config.headers['X-LLM-Key'] = apiKey;
  }
  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    const message = error.response?.data?.detail || 'Something went wrong';
    const err = new Error(message) as Error & { status?: number; errorCode?: string };
    err.status = error.response?.status;
    err.errorCode = error.response?.data?.error_code;
    return Promise.reject(err);
  }
);

export default api;
