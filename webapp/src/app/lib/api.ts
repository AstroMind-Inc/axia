import axios from 'axios';
import { getServiceUrl } from './service-url';

const API_BASE_URL = `${getServiceUrl()}/v1`;

const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
  timeout: 1200000, // 20 minute timeout for multi-agent workflows (increased from 5 min to handle long neighbor analysis)
});

export default api;
