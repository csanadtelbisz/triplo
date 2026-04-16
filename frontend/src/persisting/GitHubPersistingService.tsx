import { useState, useEffect } from 'react';
import type { ReactNode } from 'react';
import type { PersistingService, ConnectionInstruction } from './PersistingService';
import type { Trip } from '../../../shared/types';
import githubIcon from '../assets/icons/github.png';

export class GitHubPersistingService implements PersistingService {
  name = 'GitHub';
  icon = githubIcon;

  private async request(url: string, options: RequestInit = {}) {
    const token = localStorage.getItem('github_token');
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

    const content = btoa(unescape(encodeURIComponent(JSON.stringify(trip, null, 2))));
    
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
  
  useEffect(() => {
    setToken(localStorage.getItem('github_token') || '');
    setRepo(localStorage.getItem('github_repo') || '');
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
        For your safety, <b>do not use a Classic Token</b>. Instead, generate a <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener noreferrer">Fine-grained Personal Access Token</a>:<br />
        <ul style={{ margin: '8px 0', paddingLeft: '20px' }}>
          <li><b>Repository access:</b> Select <i>"Only select repositories"</i> and choose your target repository.</li>
          <li><b>Permissions:</b> Under <i>Repository permissions</i>, grant <b>Read and Write</b> access to <i>Contents</i>.</li>
        </ul>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <label htmlFor="github_token" style={{ width: '100px', fontSize: '0.85rem', fontWeight: 600 }}>Access Token:</label>
          <input
            id="github_token"
            name="github_token"
            autoComplete="new-password"
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="ghp_..."
            style={{ flex: 1, padding: '4px 8px', borderRadius: '4px', border: '1px solid #ccc' }}
          />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <label htmlFor="github_repo" style={{ width: '100px', fontSize: '0.85rem', fontWeight: 600 }}>Repository:</label>
          <input
            id="github_repo"
            name="github_repo"
            autoComplete="off"
            type="text"
            value={repo}
            onChange={(e) => setRepo(e.target.value)}
            placeholder="username/triplo-trips"
            style={{ flex: 1, padding: '4px 8px', borderRadius: '4px', border: '1px solid #ccc' }}
          />
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