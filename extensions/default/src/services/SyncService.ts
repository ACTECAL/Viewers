import { PubSubService } from '@ohif/core';

export default class SyncService extends PubSubService {
  public static readonly EVENTS = {
    SYNC_STARTED: 'event::sync_service:sync_started',
    SYNC_PROGRESS: 'event::sync_service:sync_progress',
    SYNC_COMPLETED: 'event::sync_service:sync_completed',
    SYNC_ERROR: 'event::sync_service:sync_error',
  };

  private _cloudApiEndpoint: string;
  private _localStowEndpoint: string;

  constructor() {
    super(SyncService.EVENTS);
    this._cloudApiEndpoint = '';
    this._localStowEndpoint = 'http://localhost:8042/dicom-web/studies';
  }

  public init(cloudEndpoint: string) {
    this._cloudApiEndpoint = cloudEndpoint;
  }

  /**
   * Syncs a study from the Cloud DICOM server to the Local Orthanc instance.
   * @param studyInstanceUid The UID of the study to sync
   * @param gcpToken The OAuth2 token for GCP Healthcare API
   */
  public async syncStudy(studyInstanceUid: string, gcpToken: string): Promise<boolean> {
    this._broadcastEvent(SyncService.EVENTS.SYNC_STARTED, { studyInstanceUid });

    try {
      // 1. Fetch metadata from cloud to know instances (simplified view)
      const cloudWadoUri = `${this._cloudApiEndpoint}/studies/${studyInstanceUid}`;
      
      const response = await fetch(cloudWadoUri, {
        headers: {
          Authorization: `Bearer ${gcpToken}`,
          Accept: 'multipart/related; type="application/dicom"'
        }
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch study from cloud: ${response.statusText}`);
      }

      const studyData = await response.blob();
      
      this._broadcastEvent(SyncService.EVENTS.SYNC_PROGRESS, { 
        studyInstanceUid, 
        progress: 50,
        message: 'Downloaded from Cloud. Pushing to Local Orthanc...'
      });

      // 2. STOW-RS to Local Orthanc
      const stowForm = new FormData();
      stowForm.append('file', studyData, 'study.dcm');

      const stowResponse = await fetch(this._localStowEndpoint, {
        method: 'POST',
        headers: {
          Accept: 'application/json'
        },
        body: stowForm
      });

      if (!stowResponse.ok) {
        throw new Error(`Failed to push to local Orthanc: ${stowResponse.statusText}`);
      }

      this._broadcastEvent(SyncService.EVENTS.SYNC_COMPLETED, { studyInstanceUid });
      return true;

    } catch (error) {
      console.error('Study Sync Error:', error);
      this._broadcastEvent(SyncService.EVENTS.SYNC_ERROR, { 
        studyInstanceUid, 
        error: error.message 
      });
      return false;
    }
  }
}
