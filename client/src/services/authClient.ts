import axios, { AxiosInstance, InternalAxiosRequestConfig } from 'axios';
import {
  ChatMessage,
  ChangePasswordRequest,
  AdminConfigurationItem,
  AuditLogEntry,
  BmvInquiryRequest,
  BmvInquiryResponse,
  CreateIncidentRequest,
  CreateUrgentAlertRequest,
  CourtLookupAuditRequest,
  Incident,
  IncidentNote,
  IncidentStatus,
  IncidentUnitStatus,
  IdacsInquiryRequest,
  IdacsInquiryResponse,
  IntegrationStatus,
  LoginResponse,
  Permission,
  PublicAuthSettings,
  RegisterRequest,
  RegisterResponse,
  ROLE_PERMISSIONS,
  ResetUserPasswordRequest,
  SendMessageAttachment,
  MessageThread,
  OfficerEventRequest,
  TokenPair,
  TwoFactorChallengeResponse,
  TwoFactorVerifyRequest,
  TwoFactorVerifyResponse,
  UpdateIncidentStatusRequest,
  UpdateUserRequest,
  UrgentAlert,
  UpsertConfigurationItemRequest,
  User
} from '../types/auth';
import { runtimeConfig } from '../config/runtimeConfig';

const API_URL = runtimeConfig.apiUrl;
const OFFLINE_CACHE_PREFIX = 'cad_offline_v1:';
const OFFLINE_CACHE_MAX_ENTRIES = 24;
const OFFLINE_CACHE_MAX_CHARS = 2_500_000;
const SIGNED_REQUESTS = [
  { method: 'POST', pathPattern: /^\/api\/auth\/change-password$/ },
  { method: 'POST', pathPattern: /^\/api\/auth\/verify-password$/ },
  { method: 'POST', pathPattern: /^\/api\/auth\/users$/ },
  { method: 'PATCH', pathPattern: /^\/api\/auth\/users\/[^/]+$/ },
  { method: 'POST', pathPattern: /^\/api\/auth\/users\/[^/]+\/reset-password$/ },
  { method: 'POST', pathPattern: /^\/api\/configuration$/ },
  { method: 'PATCH', pathPattern: /^\/api\/configuration\/[^/]+$/ },
  { method: 'DELETE', pathPattern: /^\/api\/configuration\/[^/]+$/ }
];

interface StoredAuth {
  user: User;
  permissions: Permission[];
  tokens: TokenPair;
  expiresAt: number;
}

interface OfflineCacheEnvelope<T> {
  value: T;
  savedAt: number;
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

  async login(email: string, password: string): Promise<StoredAuth | TwoFactorChallengeResponse> {
    const response = await this.api.post<LoginResponse | TwoFactorChallengeResponse>('/auth/login', { email, password });
    if (!response.data.success) {
      return response.data;
    }
    return this.storeAuth(response.data);
  }

  async register(input: RegisterRequest): Promise<StoredAuth | TwoFactorChallengeResponse> {
    const response = await this.api.post<RegisterResponse>('/auth/register', input);
    if (!response.data.success) {
      return response.data;
    }
    return this.storeAuth(response.data);
  }

  async verifyTwoFactor(input: TwoFactorVerifyRequest): Promise<StoredAuth & { backupCodes?: string[] }> {
    const response = await this.api.post<TwoFactorVerifyResponse>('/auth/2fa/verify', input);
    const auth = this.storeAuth(response.data);
    return { ...auth, backupCodes: response.data.backupCodes };
  }

  async getTrackedUnits(): Promise<User[]> {
    return this.cachedGet('tracked-units', async () => {
      const response = await this.api.get<User[]>('/auth/units');
      return response.data;
    }, (units) => units.slice(0, 300));
  }

  async getDirectory(): Promise<User[]> {
    return this.cachedGet('directory', async () => {
      const response = await this.api.get<User[]>('/auth/directory');
      return response.data;
    }, (users) => users.slice(0, 600));
  }

  async getUsers(): Promise<User[]> {
    const response = await this.api.get<User[]>('/auth/users');
    return response.data;
  }

  async createUser(input: RegisterRequest): Promise<User> {
    const response = await this.api.post<User>('/auth/users', input);
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

  async getAdminConfiguration(): Promise<AdminConfigurationItem[]> {
    return this.cachedGet('admin-configuration', async () => {
      const response = await this.api.get<AdminConfigurationItem[]>('/configuration');
      return response.data;
    });
  }

  async getActiveConfiguration(): Promise<AdminConfigurationItem[]> {
    return this.cachedGet('active-configuration', async () => {
      const response = await this.api.get<AdminConfigurationItem[]>('/configuration/active');
      return response.data;
    });
  }

  async getPublicAuthSettings(): Promise<PublicAuthSettings> {
    const response = await this.api.get<PublicAuthSettings>('/configuration/public/auth');
    return response.data;
  }

  async createAdminConfigurationItem(input: UpsertConfigurationItemRequest): Promise<AdminConfigurationItem> {
    const response = await this.api.post<AdminConfigurationItem>('/configuration', input);
    return response.data;
  }

  async updateAdminConfigurationItem(
    itemId: string,
    input: UpsertConfigurationItemRequest
  ): Promise<AdminConfigurationItem> {
    const response = await this.api.patch<AdminConfigurationItem>(`/configuration/${itemId}`, input);
    return response.data;
  }

  async deleteAdminConfigurationItem(itemId: string): Promise<void> {
    await this.api.delete(`/configuration/${itemId}`);
  }

  async getIntegrationStatuses(): Promise<IntegrationStatus[]> {
    const response = await this.api.get<IntegrationStatus[]>('/integrations/status');
    return response.data;
  }

  async testIntegration(code: IntegrationStatus['code']): Promise<IntegrationStatus> {
    const response = await this.api.post<IntegrationStatus>(`/integrations/${code}/test`);
    return response.data;
  }

  async auditCourtLookup(input: CourtLookupAuditRequest): Promise<void> {
    await this.api.post('/integrations/court-lookups', input);
  }

  async getInquiryHistory(limit = 200): Promise<AuditLogEntry[]> {
    const response = await this.api.get<AuditLogEntry[]>('/integrations/inquiries/history', { params: { limit } });
    return response.data;
  }

  async getMessages(userId: string, search = ''): Promise<ChatMessage[]> {
    const searchKey = search.trim().toLowerCase();
    try {
      return await this.cachedGet(`messages:${userId}:${searchKey || 'all'}`, async () => {
        const response = await this.api.get<ChatMessage[]>(`/auth/messages/${userId}`, {
          params: searchKey ? { q: search.trim() } : undefined
        });
        return response.data;
      }, (messages) => messages.slice(-150));
    } catch (error) {
      if (searchKey && this.isOfflineError(error)) {
        const cachedAll = this.getCached<ChatMessage[]>(`messages:${userId}:all`);
        if (cachedAll) {
          return cachedAll.filter((message) =>
            message.body.toLowerCase().includes(searchKey) ||
            message.attachments.some((attachment) => attachment.fileName.toLowerCase().includes(searchKey))
          );
        }
      }
      throw error;
    }
  }

  async getMessageThreads(): Promise<MessageThread[]> {
    return this.cachedGet('message-threads', async () => {
      const response = await this.api.get<MessageThread[]>('/auth/messages/threads');
      return response.data;
    }, (threads) => threads.slice(0, 120));
  }

  async markMessagesRead(userId: string): Promise<string[]> {
    const response = await this.api.post<{ messageIds: string[] }>(`/auth/messages/${userId}/read`);
    return response.data.messageIds;
  }

  async sendMessage(
    recipientId: string,
    body: string,
    attachments: SendMessageAttachment[] = []
  ): Promise<ChatMessage> {
    const response = await this.api.post<ChatMessage>('/auth/messages', { recipientId, body, attachments });
    return response.data;
  }

  async sendMessageTyping(recipientId: string, isTyping: boolean): Promise<void> {
    await this.api.post(`/auth/messages/${recipientId}/typing`, { isTyping });
  }

  async reactToMessage(messageId: string, reaction: string | null): Promise<ChatMessage> {
    const response = await this.api.patch<ChatMessage>(`/auth/messages/${messageId}/reaction`, { reaction });
    return response.data;
  }

  async deleteMessage(messageId: string): Promise<string[]> {
    const response = await this.api.delete<{ messageIds: string[] }>(`/auth/messages/${messageId}`);
    return response.data.messageIds;
  }

  async deleteMessageThread(userId: string): Promise<string[]> {
    const response = await this.api.delete<{ messageIds: string[] }>(`/auth/messages/thread/${userId}`);
    return response.data.messageIds;
  }

  async changePassword(input: ChangePasswordRequest): Promise<void> {
    await this.api.post('/auth/change-password', input);
  }

  async verifyPassword(password: string): Promise<void> {
    await this.api.post('/auth/verify-password', { password });
  }

  async getIncidents(): Promise<Incident[]> {
    return this.cachedGet('incidents', async () => {
      const response = await this.api.get<Incident[]>('/incidents');
      return response.data;
    }, (incidents) => incidents.slice(0, 300));
  }

  async createIncident(input: CreateIncidentRequest): Promise<Incident> {
    const response = await this.api.post<Incident>('/incidents', input);
    this.mergeCachedIncident(response.data);
    return response.data;
  }

  async updateIncidentStatus(incidentId: string, status: IncidentStatus, disposition?: string): Promise<Incident> {
    const input: UpdateIncidentStatusRequest = { status, disposition };
    const response = await this.api.patch<Incident>(`/incidents/${incidentId}/status`, input);
    this.mergeCachedIncident(response.data);
    return response.data;
  }

  async reopenIncident(incidentId: string): Promise<Incident> {
    const response = await this.api.post<Incident>(`/incidents/${incidentId}/reopen`);
    this.mergeCachedIncident(response.data);
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
    this.mergeCachedIncident(response.data);
    return response.data;
  }

  async assignMeToIncident(incidentId: string, status: IncidentUnitStatus = 'Assigned'): Promise<Incident> {
    const response = await this.api.post<Incident>(`/incidents/${incidentId}/assign-me`, { status });
    this.mergeCachedIncident(response.data);
    return response.data;
  }

  async updateMyIncidentStatus(incidentId: string, status: IncidentUnitStatus): Promise<Incident> {
    const response = await this.api.patch<Incident>(`/incidents/${incidentId}/my-status`, { status });
    this.mergeCachedIncident(response.data);
    return response.data;
  }

  async createOfficerEvent(input: OfficerEventRequest): Promise<Incident> {
    const response = await this.api.post<Incident>('/incidents/officer-events', input);
    this.mergeCachedIncident(response.data);
    return response.data;
  }

  async addMyIncidentNote(incidentId: string, body: string): Promise<IncidentNote> {
    const response = await this.api.post<IncidentNote>(`/incidents/${incidentId}/my-notes`, {
      body,
      noteType: 'note'
    });
    return response.data;
  }

  async submitBmvInquiry(input: BmvInquiryRequest): Promise<BmvInquiryResponse> {
    const response = await this.api.post<BmvInquiryResponse>('/bmv/inquiries', input);
    return response.data;
  }

  async submitIdacsInquiry(input: IdacsInquiryRequest): Promise<IdacsInquiryResponse> {
    const response = await this.api.post<IdacsInquiryResponse>('/idacs/inquiries', input);
    return response.data;
  }

  async getUrgentAlerts(): Promise<UrgentAlert[]> {
    return this.cachedGet('urgent-alerts', async () => {
      const response = await this.api.get<UrgentAlert[]>('/urgent-alerts');
      return response.data;
    }, (alerts) => alerts.slice(0, 100));
  }

  async getRecentUrgentAlerts(): Promise<UrgentAlert[]> {
    return this.cachedGet('recent-urgent-alerts', async () => {
      const response = await this.api.get<UrgentAlert[]>('/urgent-alerts/recent');
      return response.data;
    }, (alerts) => alerts.slice(0, 50));
  }

  async createUrgentAlert(input: CreateUrgentAlertRequest): Promise<UrgentAlert> {
    const response = await this.api.post<UrgentAlert>('/urgent-alerts', input);
    return response.data;
  }

  async sendOfficerEmergency(lat?: number | null, lon?: number | null): Promise<UrgentAlert> {
    const response = await this.api.post<UrgentAlert>('/urgent-alerts/officer-emergency', { lat, lon });
    return response.data;
  }

  async acknowledgeUrgentAlert(alertId: string): Promise<void> {
    await this.api.put(`/urgent-alerts/${alertId}/acknowledge`);
  }

  cacheIncidents(incidents: Incident[]): void {
    this.setCached('incidents', incidents.slice(0, 300));
  }

  cacheTrackedUnits(units: User[]): void {
    this.setCached('tracked-units', units.slice(0, 300));
  }

  cacheDirectory(users: User[]): void {
    this.setCached('directory', users.slice(0, 600));
  }

  cacheUrgentAlerts(alerts: UrgentAlert[]): void {
    this.setCached('urgent-alerts', alerts.slice(0, 100));
  }

  cacheMessageThreads(threads: MessageThread[]): void {
    this.setCached('message-threads', threads.slice(0, 120));
  }

  cacheMessages(userId: string, messages: ChatMessage[]): void {
    this.setCached(`messages:${userId}:all`, messages.slice(-150));
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

  private storeAuth(data: LoginResponse | TwoFactorVerifyResponse): StoredAuth {
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
    localStorage.removeItem('cad_session_locked');
    this.clearOfflineCache();
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

  private async cachedGet<T>(key: string, request: () => Promise<T>, trim?: (value: T) => T): Promise<T> {
    try {
      const value = await request();
      const cachedValue = trim ? trim(value) : value;
      this.setCached(key, cachedValue);
      return value;
    } catch (error) {
      if (this.isOfflineError(error)) {
        const cached = this.getCached<T>(key);
        if (cached !== null) return cached;
      }
      throw error;
    }
  }

  private cacheKey(key: string): string {
    const userId = this.auth?.user.id || 'public';
    return `${OFFLINE_CACHE_PREFIX}${userId}:${key}`;
  }

  private getCached<T>(key: string): T | null {
    try {
      const stored = localStorage.getItem(this.cacheKey(key));
      if (!stored) return null;
      const envelope = JSON.parse(stored) as OfflineCacheEnvelope<T>;
      return envelope.value;
    } catch {
      return null;
    }
  }

  private setCached<T>(key: string, value: T): void {
    try {
      const envelope: OfflineCacheEnvelope<T> = { value, savedAt: Date.now() };
      localStorage.setItem(this.cacheKey(key), JSON.stringify(envelope));
      this.pruneOfflineCache();
    } catch {
      this.pruneOfflineCache(true);
      try {
        const envelope: OfflineCacheEnvelope<T> = { value, savedAt: Date.now() };
        localStorage.setItem(this.cacheKey(key), JSON.stringify(envelope));
      } catch {
        // Offline cache is best-effort only.
      }
    }
  }

  private mergeCachedIncident(incident: Incident): void {
    const cached = this.getCached<Incident[]>('incidents') || [];
    this.setCached('incidents', [incident, ...cached.filter((item) => item.id !== incident.id)].slice(0, 300));
  }

  private pruneOfflineCache(force = false): void {
    const entries = this.offlineCacheKeys()
      .map((key) => {
        try {
          const envelope = JSON.parse(localStorage.getItem(key) || '{}') as Partial<OfflineCacheEnvelope<unknown>>;
          return { key, savedAt: Number(envelope.savedAt || 0), size: localStorage.getItem(key)?.length || 0 };
        } catch {
          return { key, savedAt: 0, size: localStorage.getItem(key)?.length || 0 };
        }
      })
      .sort((first, second) => first.savedAt - second.savedAt);
    let totalSize = entries.reduce((sum, entry) => sum + entry.size, 0);
    while (entries.length > 0 && (force || entries.length > OFFLINE_CACHE_MAX_ENTRIES || totalSize > OFFLINE_CACHE_MAX_CHARS)) {
      const oldest = entries.shift();
      if (!oldest) break;
      localStorage.removeItem(oldest.key);
      totalSize -= oldest.size;
      force = false;
    }
  }

  private clearOfflineCache(): void {
    this.offlineCacheKeys().forEach((key) => localStorage.removeItem(key));
  }

  private offlineCacheKeys(): string[] {
    const keys: string[] = [];
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (key?.startsWith(OFFLINE_CACHE_PREFIX)) {
        keys.push(key);
      }
    }
    return keys;
  }

  private isOfflineError(error: unknown): boolean {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return true;
    if (axios.isAxiosError(error)) {
      return !error.response || error.code === 'ERR_NETWORK' || error.code === 'ECONNABORTED';
    }
    return false;
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
