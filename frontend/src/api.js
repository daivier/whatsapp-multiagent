import axios from 'axios';

const api = axios.create({ baseURL: import.meta.env.VITE_API_URL ?? '' });

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      window.dispatchEvent(new Event('auth:force-logout'));
    }
    // Recurso bloqueado pelo plano — avisa a UI para mostrar upsell amigável
    // em vez de um erro cru. Componentes podem ouvir 'plan:upgrade-needed'.
    if (error.response?.status === 403 && error.response.data?.upgrade) {
      window.dispatchEvent(new CustomEvent('plan:upgrade-needed', { detail: error.response.data }));
    }
    return Promise.reject(error);
  }
);

export default api;
