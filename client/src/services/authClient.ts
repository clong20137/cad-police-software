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
  PublicBrandingSettings,
  RegisterRequest,
  RegisterResponse,
  ROLE_PERMISSIONS,
  ResetUserPasswordRequest,
  SendMessageAttachment,
  MessageThread,
  OfficerEventRequest,
  TokenPair,
  TwoFactorChallengeResponse,
  TwoFactorSetupResponse,
  TwoFactorVerifyRequest,
  TwoFactorVerifyResponse,
  UpdateIncidentStatusRequest,
  UpdateUserRequest,
  UrgentAlert,
  UpsertConfigurationItemRequest,
  User
} from '../types/auth';
import { runtimeConfig } from '../config/runtimeConfig';
import { offlineStore } from './offlineStore';

const API_URL = runtimeConfig.apiUrl;
const SIGNED_REQUESTS = [
  { method: 'POST', pathPattern: /^\/api\/auth\/change-password$/ },
  { method: 'POST', pathPattern: /^\/api\/auth\/2fa\/setup$/ },
  { method: 'POST', pathPattern: /^\/api\/auth\/verify-password$/ },
  { method: 'POST', pathPattern: /^\/api\/auth\/users$/ },
  { method: 'PATCH', pathPattern: /^\/api\/auth\/users\/[^/]+$/ },
  { method: 'POST', pathPattern: /^\/api\/auth\/users\/[^/]+\/reset-password$/ },
  { method: 'POST', pathPattern: /^\/api\/configuration$/ },
  { method: 'POST', pathPattern: /^\/api\/configuration\/branding\/logo$/ },
  { method: 'PATCH', pathPattern: /^\/api\/configuration\/[^/]+$/ },
  { method: 'DELETE', pathPattern: /^\/api\/configuration\/[^/]+$/ }
];

interface StoredAuth {
  user: User;
  permissions: Permission[];
  tokens: TokenPair;
  expiresAt: number;
}

type QueuedAction =
  | { id: string; type: 'assign-me'; incidentId: string; status: IncidentUnitStatus; createdAt: number }
  | { id: string; type: 'my-status'; incidentId: string; status: IncidentUnitStatus; createdAt: number }
  | { id: string; type: 'my-note'; incidentId: string; body: string; createdAt: number };

const bytesToHex = (bytes: Uint8Array): string =>
  Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');

const rightRotate = (value: number, amount: number): number => (value >>> amount) | (value << (32 - amount));

const sha256 = (bytes: Uint8Array): Uint8Array => {
  const hash = new Uint32Array([
    0x6a09e667,
    0xbb67ae85,
    0x3c6ef372,
    0xa54ff53a,
    0x510e527f,
    0x9b05688c,
    0x1f83d9ab,
    0x5be0cd19
  ]);
  const constants = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
  ]);
  const bitLength = bytes.length * 8;
  const paddedLength = (((bytes.length + 9 + 63) >> 6) << 6);
  const padded = new Uint8Array(paddedLength);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(paddedLength - 4, bitLength, false);

  const words = new Uint32Array(64);
  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let index = 0; index < 16; index += 1) {
      words[index] = view.getUint32(offset + index * 4, false);
    }
    for (let index = 16; index < 64; index += 1) {
      const s0 = rightRotate(words[index - 15], 7) ^ rightRotate(words[index - 15], 18) ^ (words[index - 15] >>> 3);
      const s1 = rightRotate(words[index - 2], 17) ^ rightRotate(words[index - 2], 19) ^ (words[index - 2] >>> 10);
      words[index] = (words[index - 16] + s0 + words[index - 7] + s1) >>> 0;
    }

    let [a, b, c, d, e, f, g, h] = Array.from(hash);
    for (let index = 0; index < 64; index += 1) {
      const s1 = rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + s1 + ch + constants[index] + words[index]) >>> 0;
      const s0 = rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (s0 + maj) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }
    hash[0] = (hash[0] + a) >>> 0;
    hash[1] = (hash[1] + b) >>> 0;
    hash[2] = (hash[2] + c) >>> 0;
    hash[3] = (hash[3] + d) >>> 0;
    hash[4] = (hash[4] + e) >>> 0;
    hash[5] = (hash[5] + f) >>> 0;
    hash[6] = (hash[6] + g) >>> 0;
    hash[7] = (hash[7] + h) >>> 0;
  }

  const output = new Uint8Array(32);
  const outputView = new DataView(output.buffer);
  hash.forEach((word, index) => outputView.setUint32(index * 4, word, false));
  return output;
};

const hmacSha256Hex = (secret: string, payload: string): string => {
  const encoder = new TextEncoder();
  let key: Uint8Array<ArrayBufferLike> = encoder.encode(secret);
  if (key.length > 64) {
    key = sha256(key);
  }

  const paddedKey = new Uint8Array(64);
  paddedKey.set(key);
  const outerKeyPad = paddedKey.map((byte) => byte ^ 0x5c);
  const innerKeyPad = paddedKey.map((byte) => byte ^ 0x36);
  const innerPayload = new Uint8Array(innerKeyPad.length + encoder.encode(payload).length);
  innerPayload.set(innerKeyPad);
  innerPayload.set(encoder.encode(payload), innerKeyPad.length);
  const innerHash = sha256(innerPayload);
  const outerPayload = new Uint8Array(outerKeyPad.length + innerHash.length);
  outerPayload.set(outerKeyPad);
  outerPayload.set(innerHash, outerKeyPad.length);
  return bytesToHex(sha256(outerPayload));
};

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
    if (typeof window !== 'undefined') {
      window.addEventListener('online', () => {
        void this.flushOfflineActions();
      });
    }
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

  async beginTwoFactorSetup(): Promise<TwoFactorSetupResponse> {
    const response = await this.api.post<TwoFactorSetupResponse>('/auth/2fa/setup');
    return response.data;
  }

  async getMe(): Promise<User> {
    const response = await this.api.get<User>('/auth/me');
    if (this.auth) {
      this.auth.user = response.data;
      this.auth.permissions = ROLE_PERMISSIONS[response.data.role] || [];
      this.saveToStorage();
    }
    return response.data;
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

  async getPublicBrandingSettings(): Promise<PublicBrandingSettings> {
    const response = await this.api.get<PublicBrandingSettings>('/configuration/public/branding');
    return response.data;
  }

  async createAdminConfigurationItem(input: UpsertConfigurationItemRequest): Promise<AdminConfigurationItem> {
    const response = await this.api.post<AdminConfigurationItem>('/configuration', input);
    void this.clearConfigurationCache();
    return response.data;
  }

  async updateAdminConfigurationItem(
    itemId: string,
    input: UpsertConfigurationItemRequest
  ): Promise<AdminConfigurationItem> {
    const response = await this.api.patch<AdminConfigurationItem>(`/configuration/${itemId}`, input);
    void this.clearConfigurationCache();
    return response.data;
  }

  async uploadApplicationLogo(input: {
    fileName: string;
    mimeType: string;
    dataUrl: string;
    logoAlt?: string;
  }): Promise<AdminConfigurationItem> {
    const response = await this.api.post<AdminConfigurationItem>('/configuration/branding/logo', input);
    void this.clearConfigurationCache();
    return response.data;
  }

  async deleteAdminConfigurationItem(itemId: string): Promise<void> {
    await this.api.delete(`/configuration/${itemId}`);
    void this.clearConfigurationCache();
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
        const cachedAll = await this.getCached<ChatMessage[]>(`messages:${userId}:all`);
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
    try {
      const response = await this.api.post<Incident>(`/incidents/${incidentId}/assign-me`, { status });
      this.mergeCachedIncident(response.data);
      return response.data;
    } catch (error) {
      if (!this.isOfflineError(error)) throw error;
      await this.enqueueAction({ id: this.queueId(), type: 'assign-me', incidentId, status, createdAt: Date.now() });
      return this.optimisticAssignMe(incidentId, status);
    }
  }

  async updateMyIncidentStatus(incidentId: string, status: IncidentUnitStatus): Promise<Incident> {
    try {
      const response = await this.api.patch<Incident>(`/incidents/${incidentId}/my-status`, { status });
      this.mergeCachedIncident(response.data);
      return response.data;
    } catch (error) {
      if (!this.isOfflineError(error)) throw error;
      await this.enqueueAction({ id: this.queueId(), type: 'my-status', incidentId, status, createdAt: Date.now() });
      return this.optimisticMyStatus(incidentId, status);
    }
  }

  async createOfficerEvent(input: OfficerEventRequest): Promise<Incident> {
    const response = await this.api.post<Incident>('/incidents/officer-events', input);
    this.mergeCachedIncident(response.data);
    return response.data;
  }

  async addMyIncidentNote(incidentId: string, body: string): Promise<IncidentNote> {
    try {
      const response = await this.api.post<IncidentNote>(`/incidents/${incidentId}/my-notes`, {
        body,
        noteType: 'note'
      });
      return response.data;
    } catch (error) {
      if (!this.isOfflineError(error)) throw error;
      const action: QueuedAction = { id: this.queueId(), type: 'my-note', incidentId, body, createdAt: Date.now() };
      await this.enqueueAction(action);
      const note: IncidentNote = {
        id: action.id,
        incidentId,
        userId: this.auth?.user.id,
        userName: this.auth?.user.name,
        noteType: 'note',
        body,
        createdAt: new Date(action.createdAt)
      };
      await this.mergeCachedNote(incidentId, note);
      return note;
    }
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
    void this.setCached('incidents', incidents.slice(0, 300));
  }

  cacheTrackedUnits(units: User[]): void {
    void this.setCached('tracked-units', units.slice(0, 300));
  }

  cacheDirectory(users: User[]): void {
    void this.setCached('directory', users.slice(0, 600));
  }

  cacheUrgentAlerts(alerts: UrgentAlert[]): void {
    void this.setCached('urgent-alerts', alerts.slice(0, 100));
  }

  cacheMessageThreads(threads: MessageThread[]): void {
    void this.setCached('message-threads', threads.slice(0, 120));
  }

  cacheMessages(userId: string, messages: ChatMessage[]): void {
    void this.setCached(`messages:${userId}:all`, messages.slice(-150));
  }

  async cacheAgeMs(key: string): Promise<number | null> {
    const record = await offlineStore.get<unknown>(this.cacheKey(key));
    return record ? Date.now() - record.savedAt : null;
  }

  async queuedActionCount(): Promise<number> {
    return (await this.getQueuedActions()).length;
  }

  async flushOfflineActions(): Promise<number> {
    if (!this.auth || (typeof navigator !== 'undefined' && navigator.onLine === false)) return 0;
    const queue = await this.getQueuedActions();
    if (queue.length === 0) return 0;

    const remaining: QueuedAction[] = [];
    let flushed = 0;
    for (const action of queue) {
      try {
        if (action.type === 'assign-me') {
          const response = await this.api.post<Incident>(`/incidents/${action.incidentId}/assign-me`, { status: action.status });
          this.mergeCachedIncident(response.data);
        } else if (action.type === 'my-status') {
          const response = await this.api.patch<Incident>(`/incidents/${action.incidentId}/my-status`, { status: action.status });
          this.mergeCachedIncident(response.data);
        } else {
          await this.api.post<IncidentNote>(`/incidents/${action.incidentId}/my-notes`, { body: action.body, noteType: 'note' });
        }
        flushed += 1;
      } catch (error) {
        remaining.push(action);
        if (this.isOfflineError(error)) break;
      }
    }
    await this.setQueuedActions(remaining);
    return flushed;
  }

  async updateLocation(lat: number, lon: number, speedMph?: number | null): Promise<User> {
    const response = await this.api.patch<User>('/auth/me/location', { lat, lon, speedMph });
    if (this.auth && response.data.id === this.auth.user.id) {
      this.auth.user = response.data;
      this.saveToStorage();
    }
    return response.data;
  }

  async updateMyStatus(status: User['status']): Promise<User> {
    const response = await this.api.patch<User>('/auth/me/status', { status });
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
      void this.setCached(key, cachedValue);
      return value;
    } catch (error) {
      if (this.isOfflineError(error)) {
        const cached = await this.getCached<T>(key);
        if (cached !== null) return cached;
      }
      throw error;
    }
  }

  private cacheKey(key: string): string {
    const userId = this.auth?.user.id || 'public';
    return `${userId}:${key}`;
  }

  private async getCached<T>(key: string): Promise<T | null> {
    const record = await offlineStore.get<T>(this.cacheKey(key));
    return record?.value ?? null;
  }

  private async setCached<T>(key: string, value: T): Promise<void> {
    await offlineStore.set(this.cacheKey(key), value);
  }

  private async clearConfigurationCache(): Promise<void> {
    const userId = this.auth?.user.id || 'public';
    await Promise.all([
      offlineStore.removePrefix(`${userId}:admin-configuration`),
      offlineStore.removePrefix(`${userId}:active-configuration`)
    ]);
  }

  private mergeCachedIncident(incident: Incident): void {
    void this.getCached<Incident[]>('incidents').then((cached) => {
      const incidents = cached || [];
      return this.setCached('incidents', [incident, ...incidents.filter((item) => item.id !== incident.id)].slice(0, 300));
    });
  }

  private async mergeCachedNote(incidentId: string, note: IncidentNote): Promise<void> {
    const incidents = (await this.getCached<Incident[]>('incidents')) || [];
    await this.setCached(
      'incidents',
      incidents.map((incident) =>
        incident.id === incidentId
          ? { ...incident, notes: [...(incident.notes || []), note], updatedAt: new Date() }
          : incident
      )
    );
  }

  private async optimisticAssignMe(incidentId: string, status: IncidentUnitStatus): Promise<Incident> {
    const incident = await this.getCachedIncident(incidentId);
    const user = this.auth?.user;
    if (!incident || !user) throw new Error('Call is not cached for offline assignment.');
    const now = new Date();
    const next: Incident = {
      ...incident,
      units: [
        ...incident.units.filter((unit) => unit.userId !== user.id),
        {
          userId: user.id,
          name: user.name,
          cadUnitNumber: user.cadUnitNumber || user.unitNumber || user.badge,
          status,
          assignedAt: now,
          statusUpdatedAt: now
        }
      ],
      updatedAt: now
    };
    await this.setCachedIncident(next);
    return next;
  }

  private async optimisticMyStatus(incidentId: string, status: IncidentUnitStatus): Promise<Incident> {
    const incident = await this.getCachedIncident(incidentId);
    const userId = this.auth?.user.id;
    if (!incident || !userId) throw new Error('Call is not cached for offline status update.');
    const now = new Date();
    const next: Incident = {
      ...incident,
      units: incident.units.map((unit) =>
        unit.userId === userId
          ? { ...unit, status, statusUpdatedAt: now, clearedAt: status === 'Cleared' ? now : unit.clearedAt }
          : unit
      ),
      updatedAt: now
    };
    await this.setCachedIncident(next);
    return next;
  }

  private async getCachedIncident(incidentId: string): Promise<Incident | null> {
    const incidents = (await this.getCached<Incident[]>('incidents')) || [];
    return incidents.find((incident) => incident.id === incidentId) || null;
  }

  private async setCachedIncident(incident: Incident): Promise<void> {
    const incidents = (await this.getCached<Incident[]>('incidents')) || [];
    await this.setCached('incidents', [incident, ...incidents.filter((item) => item.id !== incident.id)].slice(0, 300));
  }

  private async enqueueAction(action: QueuedAction): Promise<void> {
    const actions = await this.getQueuedActions();
    await this.setQueuedActions([...actions, action].slice(-100));
  }

  private async getQueuedActions(): Promise<QueuedAction[]> {
    return (await this.getCached<QueuedAction[]>('offline-actions')) || [];
  }

  private async setQueuedActions(actions: QueuedAction[]): Promise<void> {
    await this.setCached('offline-actions', actions);
  }

  private queueId(): string {
    return `offline-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  }

  private clearOfflineCache(): void {
    const userId = this.auth?.user.id || 'public';
    void offlineStore.removePrefix(`${userId}:`);
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
    if (!window.crypto?.subtle) {
      return hmacSha256Hex(token, payload);
    }

    const key = await window.crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(token),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );
    const signature = await window.crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
    return bytesToHex(new Uint8Array(signature));
  }
}

export const authClient = new AuthClient();
