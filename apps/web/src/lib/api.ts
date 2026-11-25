// API client for web app

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

class ApiClient {
  private baseUrl: string;

  constructor(baseUrl: string = API_BASE) {
    this.baseUrl = baseUrl;
  }

  private async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;
    const response = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: 'Unknown error' }));
      throw new Error(error.message || `HTTP ${response.status}`);
    }

    return response.json();
  }

  async get<T>(endpoint: string): Promise<T> {
    return this.request<T>(endpoint, { method: 'GET' });
  }

  async post<T>(endpoint: string, data: unknown): Promise<T> {
    return this.request<T>(endpoint, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async patch<T>(endpoint: string, data: unknown): Promise<T> {
    return this.request<T>(endpoint, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  }

  async delete<T>(endpoint: string): Promise<T> {
    return this.request<T>(endpoint, { method: 'DELETE' });
  }

  // Health
  async health() {
    return this.get<{ status: string; timestamp: string }>('/health');
  }

  async readiness() {
    return this.get<{ ready: boolean }>('/ready');
  }

  // Products
  async getProducts(params?: {
    page?: number;
    limit?: number;
    collection?: string;
  }): Promise<{ items: unknown[]; total: number }> {
    const search = new URLSearchParams(params as Record<string, string>).toString();
    return this.get<{ items: Record<string, unknown>[]; total: number }>(`/api/products?${search}`);
  }

  async getProduct(handle: string): Promise<Record<string, unknown>> {
    return this.get<Record<string, unknown>>(`/api/products/${handle}`);
  }

  // Cart
  async getCart(cartId: string): Promise<Record<string, unknown>> {
    return this.get<Record<string, unknown>>(`/api/cart/${cartId}`);
  }

  async addToCart(
    cartId: string,
    data: { variantId: string; quantity?: number; attributes?: Record<string, string> }
  ) {
    return this.post<Record<string, unknown>>(`/api/cart/${cartId}/lines`, data);
  }

  async updateCartLine(
    cartId: string,
    lineId: string,
    data: { quantity: number; attributes?: Record<string, string> }
  ) {
    return this.patch<Record<string, unknown>>(`/api/cart/${cartId}/lines/${lineId}`, data);
  }

  async removeCartLine(cartId: string, lineId: string): Promise<Record<string, unknown>> {
    return this.delete<Record<string, unknown>>(`/api/cart/${cartId}/lines/${lineId}`);
  }
}

export const api = new ApiClient();
