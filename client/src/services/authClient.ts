import axios, { AxiosInstance, InternalAxiosRequestConfig } from 'axios';
import {
  ChatMessage,
  ChangePasswordRequest,
  CreateIncidentRequest,
  Incident,
  IncidentNote,
  IncidentStatus,
  IncidentUnitStatus,
  LoginResponse,
  Permission,
  RegisterRequest,
  RegisterResponse,
  ROLE_PERMISSIONS,
  ResetUserPasswordRequest,
  SendMessageAttachment,
  TokenPair,
  UpdateIncidentStatusRequest,
  UpdateUserRequest,
  User
} from '../types/auth';
import { runtimeConfig } from '../config/runtimeConfig';

const API_URL = runtimeConfig.apiUrl;
const SIGNED_REQUESTS = [
  { method: 'POST', pathPattern: /^\/api\/auth\/change-password$/ },
  { method: 'PATCH', pathPattern: /^\/api\/auth\/users\/[^/]+$/ },
  { method: 'POST', pathPattern: /^\/api\/auth\/users\/[^/]+\/reset-password$/ }
];

interface StoredAuth {
  user: User;
  permissions: Permission[];
  tokens: TokenPair;
  expiresAt: number;
}

class AuthClient {
  private api: AxiosInstance;
  private auth: StoredAuth | null = null;

  constructor() {
    this.api = axios.create({
      baseURL: API_URL,
      withCredentials: true
    });

    // Add request interceptor for JWT
    this.api.interceptors.request.use(async (config: InternalAxiosRequestConfig) => {
      if (this.auth?.tokens.accessToken) {
        config.headers.Authorization = `Bearer ${this.auth.tokens.accessToken}`;
      }
      if (this.auth?.tokens.accessToken && this.needsSignature(config)) {
        const timestamp = Date.now().toString();
        config.headers['x-cad-timestamp'] = timestamp;
        config.headers['x-cad-signature'] = await this.signRequest(config, timestamp, this.auth.tokens.accessToken);
      }
      return config;
    });

    // Add response interceptor for token refresh
    this.api.interceptors.response.use(
      response => response,
      async error => {
        const originalRequest = error.config;

        if (error.response?.status === 401 && !originalRequest._retry && this.auth?.tokens.refreshToken) {
          originalRequest._retry = true;

          try {
            const response = await this.refreshToken();
            if (response) {
              originalRequest.headers.Authorization = `Bearer ${response.accessToken}`;
              return this.api(originalRequest);
            }
          } catch (refreshError) {
            this.logout();
            throw refreshError;
          }
        }

        return Promise.reject(error);
      }
    );

    this.loadFromStorage();
  }

  async login(email: string, password: string): Promise<StoredAuth> {
    const response = await this.api.post<LoginResponse>('/auth/login', { email, password });
    return this.storeAuth(response.data);
  }

  async register(input: RegisterRequest): Promise<StoredAuth> {
    const response = await this.api.post<RegisterResponse>('/auth/register', input);
    return this.storeAuth(response.data);
  }

  async getTrackedUnits(): Promise<User[]> {
    const response = await this.api.get<User[]>('/auth/units');
    return response.data;
  }

  async getDirectory(): Promise<User[]> {
    const response = await this.api.get<User[]>('/auth/directory');
    return response.data;
  }

  async getUsers(): Promise<User[]> {
    const response = await this.api.get<User[]>('/auth/users');
    return response.data;
  }

  async updateUser(userId: string, input: UpdateUserRequest): Promise<User> {
    const response = await this.api.patch<User>(`/auth/users/${userId}`, input);
    if (this.auth && response.data.id === this.auth.user.id) {
      this.auth.user = response.data;
      this.auth.permissions = ROLE_PERMISSIONS[response.data.role] || [];
      this.saveToStorage();
    }
    return response.data;
  }

  async resetUserPassword(userId: string, input: ResetUserPasswordRequest): Promise<void> {
    await this.api.post(`/auth/users/${userId}/reset-password`, input);
  }

  async getMessages(userId: string): Promise<ChatMessage[]> {
    const response = await this.api.get<ChatMessage[]>(`/auth/messages/${userId}`);
    return response.data;
  }

  async sendMessage(
    recipientId: string,
    body: string,
    attachments: SendMessageAttachment[] = []
  ): Promise<ChatMessage> {
    const response = await this.api.post<ChatMessage>('/auth/messages', { recipientId, body, attachments });
    return response.data;
  }

  async changePassword(input: ChangePasswordRequest): Promise<void> {
    await this.api.post('/auth/change-password', input);
  }

  async getIncidents(): Promise<Incident[]> {
    const response = await this.api.get<Incident[]>('/incidents');
    return response.data;
  }

  async createIncident(input: CreateIncidentRequest): Promise<Incident> {
    const response = await this.api.post<Incident>('/incidents', input);
    return response.data;
  }

  async updateIncidentStatus(incidentId: string, status: IncidentStatus, disposition?: string): Promise<Incident> {
    const input: UpdateIncidentStatusRequest = { status, disposition };
    const response = await this.api.patch<Incident>(`/incidents/${incidentId}/status`, input);
    return response.data;
  }

  async addIncidentNote(incidentId: string, body: string): Promise<IncidentNote> {
    const response = await this.api.post<IncidentNote>(`/incidents/${incidentId}/notes`, { body, noteType: 'note' });
    return response.data;
  }

  async assignIncidentUnit(
    incidentId: string,
    userId: string,
    status: IncidentUnitStatus = 'Assigned'
  ): Promise<Incident> {
    const response = await this.api.post<Incident>(`/incidents/${incidentId}/assignments`, {
      userId,
      status
    });
    return response.data;
  }

  async updateMyIncidentStatus(incidentId: string, status: IncidentUnitStatus): Promise<Incident> {
    const response = await this.api.patch<Incident>(`/incidents/${incidentId}/my-status`, { status });
    return response.data;
  }

  async addMyIncidentNote(incidentId: string, body: string): Promise<IncidentNote> {
    const response = await this.api.post<IncidentNote>(`/incidents/${incidentId}/my-notes`, {
      body,
      noteType: 'note'
    });
    return response.data;
  }

  async updateLocation(lat: number, lon: number, speedMph?: number | null): Promise<User> {
    const response = await this.api.patch<User>('/auth/me/location', { lat, lon, speedMph });
    if (this.auth && response.data.id === this.auth.user.id) {
      this.auth.user = response.data;
      this.saveToStorage();
    }
    return response.data;
  }

  async updateDestination(
    destinationLat: number | null,
    destinationLon: number | null,
    destinationLabel?: string | null
  ): Promise<User> {
    const response = await this.api.patch<User>('/auth/me/destination', {
      destinationLat,
      destinationLon,
      destinationLabel
    });
    if (this.auth && response.data.id === this.auth.user.id) {
      this.auth.user = response.data;
      this.saveToStorage();
    }
    return response.data;
  }

  private storeAuth(data: LoginResponse | RegisterResponse): StoredAuth {
    this.auth = {
      user: data.user,
      permissions: ROLE_PERMISSIONS[data.user.role] || [],
      tokens: data.tokens,
      expiresAt: Date.now() + 15 * 60 * 1000 // 15 minutes
    };
    this.saveToStorage();
    return this.auth;
  }

  async refreshToken(): Promise<TokenPair | null> {
    if (!this.auth?.tokens.refreshToken) return null;

    try {
      const response = await this.api.post('/auth/refresh', {
        refreshToken: this.auth.tokens.refreshToken
      });
      this.auth.tokens = response.data.tokens;
      this.auth.expiresAt = Date.now() + 15 * 60 * 1000;
      this.saveToStorage();
      return response.data.tokens;
    } catch (error) {
      this.logout();
      return null;
    }
  }

  async logout(): Promise<void> {
    try {
      await this.api.post('/auth/logout', {
        refreshToken: this.auth?.tokens.refreshToken
      });
    } catch (error) {
      // Logout anyway even if request fails
    }
    this.auth = null;
    localStorage.removeItem('cad_auth');
  }

  getAuth(): StoredAuth | null {
    return this.auth;
  }

  isAuthenticated(): boolean {
    return !!this.auth && this.auth.expiresAt > Date.now();
  }

  getAccessToken(): string | null {
    return this.auth?.tokens.accessToken || null;
  }

  private saveToStorage(): void {
    if (this.auth) {
      localStorage.setItem('cad_auth', JSON.stringify(this.auth));
    }
  }

  private loadFromStorage(): void {
    const stored = localStorage.getItem('cad_auth');
    if (stored) {
      try {
        this.auth = JSON.parse(stored);
        if (this.auth) {
          this.auth.permissions = ROLE_PERMISSIONS[this.auth.user.role] || [];
        }
        if (!this.isAuthenticated()) {
          this.logout();
        }
      } catch (error) {
        localStorage.removeItem('cad_auth');
      }
    }
  }

  private needsSignature(config: InternalAxiosRequestConfig): boolean {
    const method = (config.method || 'GET').toUpperCase();
    const path = this.getRequestPath(config);
    return SIGNED_REQUESTS.some((request) => request.method === method && request.pathPattern.test(path));
  }

  private getRequestPath(config: InternalAxiosRequestConfig): string {
    const baseUrl = new URL(config.baseURL || API_URL);
    const [rawPath, rawSearch = ''] = (config.url || '').split('?');
    const basePath = baseUrl.pathname.replace(/\/$/, '');
    const requestPath = rawPath.replace(/^\//, '');
    return `${basePath}/${requestPath}${rawSearch ? `?${rawSearch}` : ''}`;
  }

  private async signRequest(config: InternalAxiosRequestConfig, timestamp: string, token: string): Promise<string> {
    const body =
      config.data && typeof config.data === 'object' && Object.keys(config.data).length > 0
        ? JSON.stringify(config.data)
        : '';
    const payload = [(config.method || 'GET').toUpperCase(), this.getRequestPath(config), timestamp, body].join('\n');
    const key = await window.crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(token),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );
    const signature = await window.crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
    return Array.from(new Uint8Array(signature))
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('');
  }
}

export const authClient = new AuthClient();
