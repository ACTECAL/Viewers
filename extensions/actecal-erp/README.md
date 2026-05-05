# ACTECAL ERP Extension

This extension integrates OHIF Viewer with ACTECAL's AWS-backed medical ERP.

## Features

- Fetch study context and measurements from ACTECAL ERP.
- Save and delete measurements via API.
- Real-time updates using AWS IoT Core.
- Custom hanging protocol for 2x1 grid layout.

## Installation

1. Add the extension to your OHIF Viewer.
2. Install dependencies:
   ```bash
   npm install
   ```
3. Configure `window.config.token` for API authentication.

## Usage

- Ensure your AWS IoT Core endpoint is configured.
- Use the extension ID `actecal-erp` in your OHIF Viewer configuration.

## Development

- Run the viewer in development mode:
  ```bash
  npm start
  ```
- Modify the extension files in `src/` as needed.

## License

MIT License
