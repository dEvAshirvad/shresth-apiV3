import axios, {
  AxiosError,
  AxiosInstance,
  AxiosRequestConfig,
  AxiosResponse,
} from 'axios';
import logger from '@/configs/logger/winston';

export interface HttpClientOptions {
  baseURL?: string;
  timeoutMs?: number;
}

let defaultClient: AxiosInstance | null = null;

export function getHttpClient(options: HttpClientOptions = {}): AxiosInstance {
  if (!defaultClient) {
    defaultClient = axios.create({
      baseURL: options.baseURL,
      timeout: options.timeoutMs ?? 10000,
    });

    defaultClient.interceptors.request.use((config) => {
      logger.debug(
        `HTTP Request: ${config.method?.toUpperCase()} ${config.baseURL ?? ''}${
          config.url ?? ''
        }`
      );
      return config;
    });

    defaultClient.interceptors.response.use(
      (response: AxiosResponse) => response,
      (error: AxiosError) => {
        logger.error('HTTP Request failed', {
          message: error.message,
          url: error.config?.url,
          method: error.config?.method,
          code: error.code,
          status: error.response?.status,
        });
        return Promise.reject(error);
      }
    );
  }

  return defaultClient;
}

export async function httpGet<T = unknown>(
  url: string,
  config?: AxiosRequestConfig
): Promise<T> {
  const client = getHttpClient();
  const response = await client.get<T>(url, config);
  return response.data;
}

