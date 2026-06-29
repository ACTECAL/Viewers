const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const Store = require('electron-store');
const getPort = require('get-port');
const log = require('electron-log');

const store = new Store();

class OrthancManager {
  constructor() {
    this.orthancProcess = null;
    this.port = null;
  }

  async start() {
    if (this.orthancProcess) {
      log.info('Orthanc is already running on port', this.port);
      return this.port;
    }

    // Determine binary path based on OS
    const platform = os.platform();
    let binName = 'Orthanc';
    let binFolder = 'linux';
    
    if (platform === 'darwin') {
      binFolder = 'mac';
    } else if (platform === 'win32') {
      binFolder = 'win';
      binName = 'Orthanc.exe';
    }

    const isDev = process.defaultApp || /[\\/]electron-prebuilt[\\/]/.test(process.execPath) || /[\\/]electron[\\/]/.test(process.execPath);
    
    const binPath = isDev 
      ? path.join(__dirname, 'bin', binFolder, binName)
      : path.join(process.resourcesPath, 'bin', binFolder, binName);

    if (!fs.existsSync(binPath)) {
      log.error(`Orthanc binary not found at ${binPath}. Falling back to system Orthanc if available, or failing.`);
      // We could throw here, but for testing we might just try running 'Orthanc' from PATH
    }

    // Get Orthanc Storage Directory
    let storageDir = store.get('orthancStorageDir');
    if (!storageDir) {
      storageDir = path.join(os.homedir(), 'Library', 'Application Support', 'ActecalViewer', 'OrthancStorage');
      if (platform === 'win32') {
        storageDir = path.join(process.env.APPDATA, 'ActecalViewer', 'OrthancStorage');
      } else if (platform === 'linux') {
        storageDir = path.join(os.homedir(), '.config', 'ActecalViewer', 'OrthancStorage');
      }
      store.set('orthancStorageDir', storageDir);
    }

    if (!fs.existsSync(storageDir)) {
      fs.mkdirSync(storageDir, { recursive: true });
    }

    // Find free port for HTTP
    this.port = await getPort({ port: 8042 });
    // Find free port for DICOM (C-STORE)
    const dicomPort = await getPort({ port: 4242 });

    const configPath = path.join(os.tmpdir(), `orthanc-${Date.now()}.json`);
    const orthancConfig = {
      StorageDirectory: storageDir,
      HttpPort: this.port,
      DicomPort: dicomPort,
      AuthenticationEnabled: false,
      RemoteAccessAllowed: true,
      DicomAet: "ACTECAL_VIEWER",
      Plugins: [
        // Load DICOMweb plugin if available in the bin folder
      ]
    };

    fs.writeFileSync(configPath, JSON.stringify(orthancConfig, null, 2));

    log.info(`Starting Orthanc on HTTP port ${this.port}, DICOM port ${dicomPort}...`);
    log.info(`Orthanc Storage: ${storageDir}`);

    this.orthancProcess = spawn(fs.existsSync(binPath) ? binPath : 'Orthanc', [configPath]);

    this.orthancProcess.stdout.on('data', (data) => {
      // log.debug(`Orthanc: ${data}`);
    });

    this.orthancProcess.stderr.on('data', (data) => {
      // log.error(`Orthanc Err: ${data}`);
    });

    this.orthancProcess.on('close', (code) => {
      log.info(`Orthanc process exited with code ${code}`);
      this.orthancProcess = null;
      try {
        if (fs.existsSync(configPath)) {
          fs.unlinkSync(configPath);
        }
      } catch(e) {}
    });

    return this.port;
  }

  stop() {
    if (this.orthancProcess) {
      log.info('Stopping Orthanc...');
      this.orthancProcess.kill('SIGINT');
      this.orthancProcess = null;
    }
  }
}

module.exports = new OrthancManager();
