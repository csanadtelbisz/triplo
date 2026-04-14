import { useState, useEffect } from 'react';
import type { ReactNode } from 'react';
import type { Trip } from '../../../shared/types';
import type { PersistingService, ConnectionInstruction } from './PersistingService';
import gdriveIcon from '../assets/icons/google_drive.png';

const SCOPES = 'https://www.googleapis.com/auth/drive.file';

// Tell TypeScript about the Google Identity Services global
declare const google: any;

export class GoogleDrivePersistingService implements PersistingService {
  name = 'Google Drive';
  icon = gdriveIcon;

  private tokenClient: any = null;
  private gisInited: boolean = false;

  constructor() {
    this.loadScripts();
  }

  private loadScripts() {
    // Load GIS early to enable future button clicks
    if (document.getElementById('gis-client-script')) return;

    const script = document.createElement('script');
    script.id = 'gis-client-script';
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.onload = () => {
      this.gisInited = true;
    };
    document.body.appendChild(script);
  }

  private initTokenClient(callback: () => void) {
    if (!this.gisInited || !google) {
      console.error('Google Identity Services not loaded yet. Please try again in a moment.');
      return;
    }

    const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;
    if (!clientId) {
      console.error('Google Client ID is missing.');
      return;
    }

    this.tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: SCOPES,
      callback: (tokenResponse: any) => {
        if (tokenResponse.error !== undefined) {
          console.error(tokenResponse);
          return;
        }
        // Save token and approximate expiration (token returns expires_in seconds, usually 3599)
        const expiresAt = Date.now() + (tokenResponse.expires_in * 1000);
        localStorage.setItem('gdrive_access_token', tokenResponse.access_token);
        localStorage.setItem('gdrive_token_expires_at', expiresAt.toString());
        callback();
        // Since session is active, reload or trigger UI update
        window.dispatchEvent(new Event('storage')); 
      },
    });
    this.tokenClient.requestAccessToken({ prompt: 'consent' });
  }

  private getAccessToken(): string | null {
    const token = localStorage.getItem('gdrive_access_token');
    const expiresAt = localStorage.getItem('gdrive_token_expires_at');
    if (!token || !expiresAt) return null;

    if (Date.now() > parseInt(expiresAt, 10)) {
      // Token expired
      localStorage.removeItem('gdrive_access_token');
      localStorage.removeItem('gdrive_token_expires_at');
      return null;
    }
    return token;
  }

  private async request(path: string, options: RequestInit = {}): Promise<any> {
    const token = this.getAccessToken();
    if (!token) throw new Error("No Google Drive access token");

    const url = path.startsWith('http') ? path : `https://www.googleapis.com/drive/v3/${path}`;
    const res = await fetch(url, {
      ...options,
      headers: {
        'Authorization': `Bearer ${token}`,
        ...(options.headers || {})
      }
    });

    if (!res.ok) {
       throw new Error(`Drive API Error: ${res.status} - ${res.statusText}`);
    }

    const contentType = res.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      return res.json();
    }
    return res.text();
  }

  private async getOrCreateFolder(): Promise<string> {
    const folderName = localStorage.getItem('gdrive_folder_name') || 'Triplo Trips';
    const safeName = folderName.replace(/'/g, "\\'");
    const q = encodeURIComponent(`mimeType='application/vnd.google-apps.folder' and name='${safeName}' and trashed=false`);
    
    let res;
    try {
      res = await this.request(`files?q=${q}&spaces=drive`);
    } catch (e) {
      console.error("Failed to query drive folder", e);
      throw e;
    }

    if (res.files && res.files.length > 0) {
      return res.files[0].id;
    }
    
    // Create folder because it doesn't exist
    const createRes = await this.request('files', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: folderName,
        mimeType: 'application/vnd.google-apps.folder'
      })
    });
    return createRes.id;
  }

  async load(): Promise<any[]> {
    if (!this.getAccessToken()) return [];

    try {
      const folderId = await this.getOrCreateFolder();
      const q = encodeURIComponent(`'${folderId}' in parents and name contains '.triplo.json' and trashed=false`);
      const res = await this.request(`files?q=${q}&spaces=drive&fields=files(id, name)`);

      if (!res.files || res.files.length === 0) return [];

      const trips: any[] = [];
      const filePromises = res.files.map(async (file: any) => {
        try {
           const fileData = await this.request(`files/${file.id}?alt=media`);
           const tripObj = typeof fileData === 'string' ? JSON.parse(fileData) : fileData;
           return tripObj;
        } catch (e) {
           console.error(`Failed to parse trip ${file.name}`, e);
           return null;
        }
      });
      
      const results = await Promise.all(filePromises);
      results.forEach((t: any) => { if (t) trips.push(t); });
      return trips;

    } catch (e) {
      console.error("Failed to load trips from Drive", e);
      return [];
    }
  }

  async save(trip: any): Promise<void> {
    if (!this.getAccessToken()) throw new Error("Google Drive token not available");

    const content = JSON.stringify(trip, null, 2);
    const fileName = `${trip.id}.triplo.json`;
    const folderId = await this.getOrCreateFolder();

    const q = encodeURIComponent(`'${folderId}' in parents and name='${fileName}' and trashed=false`);
    const searchRes = await this.request(`files?q=${q}&spaces=drive`);
    
    let fileId;
    if (searchRes.files && searchRes.files.length > 0) {
        fileId = searchRes.files[0].id;
    } else {
        const createRes = await this.request('files', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: fileName, parents: [folderId] })
        });
        fileId = createRes.id;
    }

    await this.request(`https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: content
    });
  }

  async saveAll(trips: any[]): Promise<void> {
    for (const trip of trips) {
      await this.save(trip);
    }
  }

  async delete(tripId: string): Promise<void> {
    if (!this.getAccessToken()) return;

    try {
      const fileName = `${tripId}.triplo.json`;
      const folderId = await this.getOrCreateFolder();

      const q = encodeURIComponent(`'${folderId}' in parents and name='${fileName}' and trashed=false`);
      const searchRes = await this.request(`files?q=${q}&spaces=drive`);
      
      if (searchRes.files && searchRes.files.length > 0) {
        for (const file of searchRes.files) {
          await this.request(`files/${file.id}`, { method: 'DELETE' });
        }
      }
    } catch (e) {
      console.error(`Failed to delete trip ${tripId} from Google Drive`, e);
    }
  }

  isAvailable(): boolean {
    return this.getAccessToken() !== null;
  }

  getConnectionInstruction(): ConnectionInstruction {
    return {
      htmlDescription: 'Connect to Google Drive to save and sync your trips continuously across sessions.',
      actionButtonLabel: 'Login to Google Drive',
      onAction: (onSuccess?: () => void, openConfigDialog?: () => void) => {
        this.initTokenClient(() => {
          console.log('Successfully connected to Google Drive');
          if (onSuccess) onSuccess();
          if (openConfigDialog) openConfigDialog();
        });
      }
    };
  }

  openConfigurationDialog() {
    // legacy alert fallback, ignored if UI is rendered.
  }

  renderConfigUI({ trips, onUpdateTrips }: { trips: Trip[], onUpdateTrips?: (trips: Trip[]) => void }): ReactNode {
    return <GoogleDriveConfig service={this} trips={trips} onUpdateTrips={onUpdateTrips} />;
  }
}

function GoogleDriveConfig({ service, trips, onUpdateTrips }: { service: GoogleDrivePersistingService, trips: Trip[], onUpdateTrips?: (trips: Trip[]) => void }) {
  const [folderName, setFolderName] = useState(() => localStorage.getItem('gdrive_folder_name') || 'Triplo Trips');

  useEffect(() => {
    // keeping in case we need to react to storage events later, but hydration is now sync
  }, []);

  const handleSaveConfig = async () => {
    localStorage.setItem('gdrive_folder_name', folderName);
    try {
      const remoteTrips = await service.load();
      const remoteIds = remoteTrips.map(rt => rt.id);
      let changed = false;
      trips.forEach(t => {
        if (remoteIds.includes(t.id)) {
          t.metadata.syncedServices = t.metadata.syncedServices ? [...t.metadata.syncedServices, service.name] : [service.name];
          changed = true;
        }
      });
      if (changed && onUpdateTrips) {
        onUpdateTrips([...trips]); // trigger re-render
      }
    } catch (err) {
      console.error("Failed to fetch remote folder trips.", err);
    }
  };

  return (
    <div>
      <label style={{ display: 'block', fontSize: '0.85rem', marginBottom: '4px' }}>Sync Folder Name</label>
      <div style={{ display: 'flex', gap: '8px' }}>
        <input
          type="text"
          value={folderName}
          onChange={(e) => setFolderName(e.target.value)}
          style={{ flex: 1, padding: '4px 8px', borderRadius: '4px', border: '1px solid #ccc' }}
        />
        <button className="dialog-btn dialog-btn-primary" onClick={handleSaveConfig}>
          Save
        </button>
      </div>
    </div>
  );
}
