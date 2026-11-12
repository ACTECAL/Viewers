// CloudFront Function (runtime cloudfront-js-2.0, viewer-request) for the public offline edition of Spectra
// at https://spectra.actecal.com/offline/ (deploy-offline.sh uploads the build to the bucket's offline/ prefix).
//
// Why: the offline build is a single-page app under /offline/. Its routes (/offline/, /offline/viewer/dicomlocal)
// have no S3 object, and the distribution's own error-page fallback would serve the main viewer's index.html.
// This function serves /offline/index.html for every extension-less path, and redirects /offline to /offline/.
//
// Deploying it changes the live distribution, so it needs approval:
//   1. CloudFront > Functions > Create "spectra-offline-rewrite" (cloudfront-js-2.0), paste this file, test
//      /offline, /offline/, /offline/viewer/dicomlocal and /offline/app-config.js, then Publish.
//   2. Distribution > Behaviors > Create two behaviours on the same S3 origin as the default one:
//      path pattern "/offline/*" and path pattern "/offline", each with this function on Viewer request.
//      Give /offline/index.html and /offline/app-config.js a short TTL (or rely on deploy-offline.sh's invalidation).
//   3. Optional, recommended: a response-headers policy on both behaviours with this Content-Security-Policy
//      (tested with the offline build). It keeps the page from sending anything to other sites:
//        default-src 'self'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline';
//        img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' data: blob:; worker-src 'self' blob:;
//        object-src 'none'; base-uri 'self'; form-action 'none'; frame-ancestors 'none'
//   4. Check: /offline/ and /offline/viewer/dicomlocal return the offline index.html; /offline returns 301.

function handler(event) {
  var request = event.request;
  var uri = request.uri;

  if (uri === '/offline') {
    return {
      statusCode: 301,
      statusDescription: 'Moved Permanently',
      headers: { location: { value: '/offline/' }, 'cache-control': { value: 'max-age=3600' } },
    };
  }

  var lastSegment = uri.substring(uri.lastIndexOf('/') + 1);
  if (lastSegment.indexOf('.') === -1) request.uri = '/offline/index.html';
  return request;
}
