import { useState, useEffect } from 'react';
import type { ReactNode } from 'react';
import type { PersistingService, ConnectionInstruction } from './PersistingService';
import type { Trip } from '../../../shared/types';
import githubIcon from '../assets/icons/github.png';
import { decodeSharePayload, encodeSharePayload } from '../utils/shareLinkEncoding';

export class GitHubPersistingService implements PersistingService {
  name = 'GitHub' as const;
  icon = githubIcon;

  private getAuthToken() {
    return localStorage.getItem('github_token');
  }

  private getShareToken() {
    return localStorage.getItem('github_share_token') || this.getAuthToken();
  }

  private async request(url: string, options: RequestInit = {}) {
    const token = this.getAuthToken();
    if (!token) throw new Error('GitHub token missing');

    const response = await fetch(`https://api.github.com${url}`, {
      cache: 'no-store',
      ...options,
      headers: {
        'Accept': 'application/vnd.github+json',
        'Authorization': `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28',
        ...(options.headers || {})
      }
    });

    return response;
  }

  private getRepo() {
    return localStorage.getItem('github_repo');
  }

  private encodeUtf8Base64(value: string) {
    return btoa(unescape(encodeURIComponent(value)));
  }

  private parseTripContent(content: string): Trip | null {
    try {
      return JSON.parse(content) as Trip;
    } catch {
      try {
        const normalized = content
          .replace(/\\n/g, '\n')
          .replace(/\\r/g, '\r')
          .replace(/\\t/g, '\t')
          .replace(/\\"/g, '"')
          .replace(/\\\\/g, '\\');
        return JSON.parse(normalized) as Trip;
      } catch (error) {
        console.error('Failed to parse GitHub shared trip content:', error);
        return null;
      }
    }
  }

  private async loadTextFile(path: string): Promise<string | null> {
    if (!this.isAvailable()) return null;
    const repo = this.getRepo();
    try {
      // Request the raw file bytes directly instead of the default JSON+base64
      // representation. The Contents API only populates `content` for files up
      // to 1MB; for 1-100MB files you must request the raw media type to get
      // the actual data back.
      const res = await this.request(`/repos/${repo}/contents/${path}`, {
        headers: { 'Accept': 'application/vnd.github.raw+json' }
      });
      if (res.status === 404 || res.status === 409) return null;
      if (!res.ok) throw new Error(`Failed to load ${path}: ${res.statusText}`);

      return await res.text();
    } catch (e) {
      console.error(`GitHubPersistingService.loadTextFile failed for ${path}:`, e);
      return null;
    }
  }

  private async saveTextFile(path: string, content: string, message: string): Promise<void> {
    if (!this.isAvailable()) return;
    const repo = this.getRepo();
    const encodedContent = this.encodeUtf8Base64(content);

    for (let attempt = 0; attempt < 3; attempt++) {
      let sha: string | undefined;
      try {
        const getRes = await this.request(`/repos/${repo}/contents/${path}`);
        if (getRes.ok) {
          const getData = await getRes.json();
          sha = getData.sha;
        }
      } catch {
        // Ignore if not found
      }

      const body = JSON.stringify({
        message,
        content: encodedContent,
        ...(sha ? { sha } : {})
      });

      const putRes = await this.request(`/repos/${repo}/contents/${path}`, {
        method: 'PUT',
        body
      });

      if (putRes.ok) return;

      const text = await putRes.text();
      if (putRes.status === 409 && attempt < 2) {
        console.warn(`Retrying GitHub preference file save after conflict for ${path}: ${text}`);
        continue;
      }

      console.error(`Failed to push ${path} to GitHub: ${putRes.status} ${text}`);
      throw new Error(`GitHub sync failed: ${putRes.statusText}`);
    }
  }

  private async deleteTextFile(path: string, message: string): Promise<void> {
    if (!this.isAvailable()) return;
    const repo = this.getRepo();

    for (let attempt = 0; attempt < 3; attempt++) {
      const getRes = await this.request(`/repos/${repo}/contents/${path}`);
      if (getRes.status === 404 || getRes.status === 409) return;
      if (!getRes.ok) throw new Error(`Failed to load ${path} for delete: ${getRes.statusText}`);

      const fileData = await getRes.json();
      const body = JSON.stringify({
        message,
        sha: fileData.sha
      });

      const deleteRes = await this.request(`/repos/${repo}/contents/${path}`, {
        method: 'DELETE',
        body
      });

      if (deleteRes.ok) return;

      const text = await deleteRes.text();
      if (deleteRes.status === 409 && attempt < 2) {
        console.warn(`Retrying GitHub preference file delete after conflict for ${path}: ${text}`);
        continue;
      }

      console.error(`Failed to delete ${path} from GitHub: ${deleteRes.status} ${text}`);
      throw new Error(`GitHub delete failed: ${deleteRes.statusText}`);
    }
  }

  async load(): Promise<any[]> {
    if (!this.isAvailable()) return [];
    const repo = this.getRepo();

    try {
      const res = await this.request(`/repos/${repo}/contents/trips`);
      if (res.status === 404 || res.status === 409) return []; // No trips folder yet, or completely empty repo
      if (res.status === 401) {
        localStorage.removeItem('github_token');
        throw new Error('401 Unauthorized. The GitHub token provided is invalid or has expired.');
      }
      if (!res.ok) throw new Error(`Failed to list trips: ${res.statusText}`);

      const files = await res.json();
      if (!Array.isArray(files)) return [];

      const trips: any[] = [];
      await Promise.all(
        files.filter(f => f.name.endsWith('.triplo.json')).map(async (file) => {
          try {
            const fileRes = await fetch(file.download_url, { cache: 'no-store' });
            if (fileRes.ok) {
              const tripData = await fileRes.json();
              if (tripData && tripData.id) {
                 trips.push(tripData);
              }
            }
          } catch (e) {
            console.error(`Failed to load file ${file.name}`, e);
          }
        })
      );
      return trips;
    } catch (e) {
      console.error('Failed to load trips from GitHub', e);
      return [];
    }
  }

  async save(trip: any): Promise<void> {
    if (!this.isAvailable()) throw new Error('GitHub service unavailable');
    const repo = this.getRepo();
    const path = `trips/${trip.id}.triplo.json`;
    
    let sha: string | undefined;
    
    // Check if exists to get SHA
    try {
      const res = await this.request(`/repos/${repo}/contents/${path}`);
      if (res.ok) {
        const fileData = await res.json();
        sha = fileData.sha;
      }
    } catch (e) {
      // Ignored: probably 404 which means new file
    }

    const content = this.encodeUtf8Base64(JSON.stringify(trip, null, 2));
    
    const body = JSON.stringify({
      message: `Triplo: Sync trip ${trip.name || trip.id}`,
      content,
      ...(sha ? { sha } : {})
    });

    const saveRes = await this.request(`/repos/${repo}/contents/${path}`, {
      method: 'PUT',
      body
    });

    if (!saveRes.ok) {
      const errText = await saveRes.text();
      if (saveRes.status === 401) {
        localStorage.removeItem('github_token');
        throw new Error(`401 Unauthorized. The GitHub token provided is invalid or has expired. Please re-configure GitHub syncing. Details: ${errText}`);
      }
      throw new Error(`Failed to save trip to GitHub: ${saveRes.status} ${errText}`);
    }
  }

  async saveAll(trips: any[]): Promise<void> {
    for (const trip of trips) {
      await this.save(trip);
    }
  }

  async delete(tripId: string): Promise<void> {
    if (!this.isAvailable()) return;
    const repo = this.getRepo();
    const path = `trips/${tripId}.triplo.json`;
    
    let sha: string | undefined;
    try {
      const res = await this.request(`/repos/${repo}/contents/${path}`);
      if (res.ok) {
        const fileData = await res.json();
        sha = fileData.sha;
      } else {
        return; // File does not exist
      }
    } catch (e) {
      return; // Ignored: probably 404
    }

    if (!sha) return;

    const body = JSON.stringify({
      message: `Triplo: Delete trip ${tripId}`,
      sha
    });

    const deleteRes = await this.request(`/repos/${repo}/contents/${path}`, {
      method: 'DELETE',
      body
    });

    if (!deleteRes.ok) {
      const errText = await deleteRes.text();
      console.error(`Failed to delete trip ${tripId} from GitHub: ${deleteRes.status} ${errText}`);
    }
  }

  async loadPreferences(): Promise<any | null> {
    try {
      const content = await this.loadTextFile('preferences.json');
      return content ? JSON.parse(content) : null;
    } catch (e) {
      console.error('GitHubPersistingService.loadPreferences parse failed:', e);
      return null;
    }
  }

  async savePreferences(prefs: any): Promise<void> {
    await this.saveTextFile('preferences.json', JSON.stringify(prefs, null, 2), 'Update Triplo preferences');
  }

  async loadPreferenceFile(path: string): Promise<string | null> {
    return this.loadTextFile(path);
  }

  async savePreferenceFile(path: string, content: string): Promise<void> {
    await this.saveTextFile(path, content, `Update Triplo preference file ${path}`);
  }

  async deletePreferenceFile(path: string): Promise<void> {
    await this.deleteTextFile(path, `Delete Triplo preference file ${path}`);
  }

  async shareTrip(trip: Trip): Promise<string> {
    const token = this.getShareToken();
    if (!token) throw new Error('GitHub share token missing');
    const fileName = `${trip.id}.triplo.json`;
    const response = await fetch('https://api.github.com/gists', {
      method: 'POST',
      cache: 'no-store',
      headers: {
        'Accept': 'application/vnd.github+json',
        'Authorization': `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        description: `Triplo shared trip ${trip.name || trip.id}`,
        public: false,
        files: {
          [fileName]: {
            content: JSON.stringify(trip, null, 2)
          }
        }
      })
    });

    if (!response.ok) {
      throw new Error(`Failed to create GitHub gist share: ${response.status} ${await response.text()}`);
    }

    const gist = await response.json();
    return encodeSharePayload({
      service: this.name,
      data: gist.id
    });
  }

  async revokeShare(shareLink: string): Promise<void> {
    const payload = decodeSharePayload(shareLink);
    if (!payload || payload.service !== this.name || !payload.data) return;

    const token = this.getShareToken();
    if (!token) return;

    await fetch(`https://api.github.com/gists/${payload.data}`, {
      method: 'DELETE',
      cache: 'no-store',
      headers: {
        'Accept': 'application/vnd.github+json',
        'Authorization': `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28'
      }
    });
  }

  async fetchSharedTrip(shareLink: string): Promise<Trip | null> {
    const payload = decodeSharePayload(shareLink);
    if (!payload || payload.service !== this.name || !payload.data) return null;

    try {
      const response = await fetch(`https://api.github.com/gists/${payload.data}`, { cache: 'no-store' });
      if (!response.ok) return null;

      const gist = await response.json();
      const files = gist.files
        ? Object.values(gist.files) as Array<{ raw_url?: string; content?: string; truncated?: boolean }>
        : [];
      const firstFile = files[0];
      if (!firstFile) return null;

      // GitHub's Gist API only inlines up to 1MB of a file's content.
      // For larger files it sets truncated: true, and `content` will be a
      // cut-off (invalid) fragment — we must fetch raw_url for the full text.
      if (firstFile.content && !firstFile.truncated) {
        const parsed = this.parseTripContent(firstFile.content);
        if (parsed) return parsed;
        // Fall through to raw_url even if truncated wasn't set but parsing
        // still failed, as a safety net.
      }

      if (!firstFile.raw_url) return null;
      const rawResponse = await fetch(firstFile.raw_url, { cache: 'no-store' });
      if (!rawResponse.ok) return null;
      return this.parseTripContent(await rawResponse.text());
    } catch (error) {
      console.error('Failed to fetch shared GitHub trip:', error);
      return null;
    }
  }

  async updateSharedTrip(shareLink: string, trip: Trip): Promise<void> {
    const payload = decodeSharePayload(shareLink);
    if (!payload || payload.service !== this.name || !payload.data) return;
    const token = this.getShareToken();
    if (!token) throw new Error('GitHub share token missing');

    const response = await fetch(`https://api.github.com/gists/${payload.data}`, {
      method: 'PATCH',
      cache: 'no-store',
      headers: {
        'Accept': 'application/vnd.github+json',
        'Authorization': `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        files: { [`${trip.id}.triplo.json`]: { content: JSON.stringify(trip, null, 2) } }
      })
    });
    if (!response.ok) throw new Error(`Failed to update GitHub shared trip: ${response.status} ${await response.text()}`);
  }

  async disconnect(): Promise<void> {
    localStorage.removeItem('github_token');
    localStorage.removeItem('github_repo');
    localStorage.removeItem('github_share_token');
    window.dispatchEvent(new Event('preferences-updated'));
    window.dispatchEvent(new Event('storage'));
  }

  isAvailable(): boolean {
    return !!localStorage.getItem('github_token') && !!localStorage.getItem('github_repo');
  }

  getConnectionInstruction(): ConnectionInstruction {
    return {
      htmlDescription: `Connect to GitHub to save and sync your trips as JSON files in a dedicated repository.`,
      actionButtonLabel: 'Configure GitHub',
      onAction: (_onSuccess?: () => void, openConfigDialog?: () => void) => {
        if (openConfigDialog) {
          openConfigDialog();
        }
      }
    };
  }

  renderConfigUI({ trips, onUpdateTrips }: { trips: Trip[], onUpdateTrips?: (trips: Trip[]) => void }): ReactNode {
    return <GitHubConfig service={this} trips={trips} onUpdateTrips={onUpdateTrips} />;
  }
}

export function GitHubConfig({ service, trips, onUpdateTrips }: { service: GitHubPersistingService, trips: Trip[], onUpdateTrips?: (trips: Trip[]) => void }) {
  const [token, setToken] = useState('');
  const [repo, setRepo] = useState('');
  const [shareToken, setShareToken] = useState('');
  const [showToken, setShowToken] = useState(false);
  const [showShareToken, setShowShareToken] = useState(false);
  
  useEffect(() => {
    setToken(localStorage.getItem('github_token') || '');
    setRepo(localStorage.getItem('github_repo') || '');
    setShareToken(localStorage.getItem('github_share_token') || '');
  }, []);

  const handleSaveConfig = async () => {
    if (!token || !repo) {
       alert('Both Token and Repository are required.');
       return;
    }

    const cleanToken = token.trim();
    const cleanRepo = repo.trim();

    try {
      const authCheck = await fetch(`https://api.github.com/repos/${cleanRepo}/contents/trips`, {
        headers: {
          'Accept': 'application/vnd.github+json',
          'Authorization': `Bearer ${cleanToken}`,
          'X-GitHub-Api-Version': '2022-11-28'
        }
      });
      
      if (authCheck.status === 401) {
        alert('GitHub returned 401 Unauthorized. Please check your token format and permissions.');
        return;
      }
      // 404 is completely fine (the repository or the 'trips' folder is empty/missing).
      // 409 is also possible for completely empty repositories without branches.
    } catch (err) {
      console.error("Auth check failed:", err);
    }

    localStorage.setItem('github_token', cleanToken);
    localStorage.setItem('github_repo', cleanRepo);
    localStorage.setItem('github_share_token', shareToken.trim());

    try {
      const remoteTrips = await service.load();
      const remoteIds = remoteTrips.map(rt => rt.id);
      let changed = false;
      const updatedTrips = trips.map(t => {
        if (remoteIds.includes(t.id)) {
          const newServices = t.metadata?.syncedServices ? [...new Set([...t.metadata.syncedServices, service.name])] : [service.name];
          if (newServices.length !== t.metadata?.syncedServices?.length) {
            changed = true;
          }
          t.metadata = t.metadata || {};
          t.metadata.syncedServices = newServices;
        }
        return t;
      });
      if (changed && onUpdateTrips) {
        onUpdateTrips([...updatedTrips]);
      }
    } catch (err) {
      console.error("Failed to sync on Github save config.", err);
    }
  };

  return (
    <div style={{ marginTop: '12px', background: '#f8f9fa', padding: '12px', borderRadius: '8px', border: '1px solid #dee2e6' }}>
      <h4 style={{ margin: '0 0 12px 0', fontSize: '0.95rem' }}>GitHub Configuration</h4>

      <div style={{ fontSize: '0.85rem', marginBottom: '12px', color: '#555' }}>
        <b>Security Best Practice:</b> Triplo runs purely in your browser, meaning it must store your access token locally.
        For security, <b>do not use a Classic Token</b>. Instead, generate a <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener noreferrer">Fine-grained Personal Access Token</a>:<br />
        <ul style={{ margin: '8px 0', paddingLeft: '20px' }}>
          <li><b>Repository access:</b> Select <i>"Only select repositories"</i> and choose your target repository.</li>
          <li><b>Permissions:</b> Under <i>Repository permissions</i>, grant <b>Read and Write</b> access to <i>Contents</i>.</li>
        </ul>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        <div>
          <label htmlFor="github_repo" style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600 }}>Repository</label>
          <input
            id="github_repo"
            name="github_repo"
            autoComplete="off"
            type="text"
            value={repo}
            onChange={(e) => setRepo(e.target.value)}
            placeholder="username/triplo-trips"
            style={{ width: '100%', padding: '4px 8px', borderRadius: '4px', border: '1px solid #ccc', height: '32px' }}
          />
        </div>
        <div>
          <label htmlFor="github_token" style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600 }}>Access Token</label>
          <div style={{ display: 'flex', gap: '8px' }}>
            <input
              id="github_token"
              name="github_token"
              autoComplete="new-password"
              type={showToken ? 'text' : 'password'}
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="ghp_..."
              style={{ flex: 1, minWidth: 0, padding: '4px 8px', borderRadius: '4px', border: '1px solid #ccc' }}
            />
            <button type="button" className="iconButton" onClick={() => setShowToken(visible => !visible)} title={showToken ? 'Hide access token' : 'Show access token'} aria-label={showToken ? 'Hide access token' : 'Show access token'}>
              <span className="material-symbols-rounded" style={{ fontSize: '16px'}}>{showToken ? 'visibility_off' : 'visibility'}</span>
            </button>
          </div>
        </div>
        <div>
          <label htmlFor="github_share_token" style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600 }}>Share Token</label>
          <div style={{ display: 'flex', gap: '8px' }}>
            <input
              id="github_share_token"
              name="github_share_token"
              autoComplete="new-password"
              type={showShareToken ? 'text' : 'password'}
              value={shareToken}
              onChange={(e) => setShareToken(e.target.value)}
              placeholder="Optional"
              style={{ flex: 1, minWidth: 0, padding: '4px 8px', borderRadius: '4px', border: '1px solid #ccc' }}
            />
            <button type="button" className="iconButton" onClick={() => setShowShareToken(visible => !visible)} title={showShareToken ? 'Hide share token' : 'Show share token'} aria-label={showShareToken ? 'Hide share token' : 'Show share token'}>
              <span className="material-symbols-rounded" style={{ fontSize: '16px'}}>{showShareToken ? 'visibility_off' : 'visibility'}</span>
            </button>
          </div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '8px' }}>
          <button className="dialog-btn dialog-btn-primary" onClick={handleSaveConfig}>
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
