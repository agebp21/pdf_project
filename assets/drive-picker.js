/* "Add source → Google Drive": pick a file from the reader's own Drive with the
 * Google Picker and download it in the browser.
 *
 * Sign-in is Google Identity Services' token client with the drive.file scope:
 * the app only gets the files the reader picks (no access to the rest of the
 * Drive, no Google verification needed). Google Docs/Sheets/Slides are exported
 * as PDF; other files (PDF, Office, images) are downloaded as they are.
 *
 * config = {clientId, apiKey, appId} from /api/capabilities (drive).
 */
(function (root) {
  'use strict';

  var SCOPE = 'https://www.googleapis.com/auth/drive.file';
  var GOOGLE_DOCS = {
    'application/vnd.google-apps.document': 'application/pdf',
    'application/vnd.google-apps.presentation': 'application/pdf',
    'application/vnd.google-apps.spreadsheet': 'application/pdf',
    'application/vnd.google-apps.drawing': 'application/pdf',
  };
  var MIME_TYPES = [
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/msword',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation', 'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.ms-excel', 'text/csv',
    'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/bmp', 'image/avif',
  ].concat(Object.keys(GOOGLE_DOCS));

  var scripts = {};
  function loadScript(src) {
    if (!scripts[src]) {
      scripts[src] = new Promise(function (resolve, reject) {
        var s = document.createElement('script');
        s.src = src; s.async = true;
        s.onload = resolve;
        s.onerror = function () { delete scripts[src]; reject(new Error('Google Drive could not be loaded. Check the internet connection.')); };
        document.head.appendChild(s);
      });
    }
    return scripts[src];
  }

  var ready = null;
  // Load Google's scripts early (when the Add source dialog opens), so the
  // sign-in pop-up opens straight from the click and isn't blocked.
  function preload() {
    if (!ready) {
      ready = Promise.all([
        loadScript('https://apis.google.com/js/api.js').then(function () {
          return new Promise(function (resolve, reject) {
            root.gapi.load('picker', { callback: resolve, onerror: function () { reject(new Error('Google Picker could not be loaded.')); } });
          });
        }),
        loadScript('https://accounts.google.com/gsi/client'),
      ]).catch(function (cause) { ready = null; throw cause; });
    }
    return ready;
  }

  var token = null, tokenUntil = 0, tokenClient = null, tokenClientId = '';
  function accessToken(config) {
    if (token && Date.now() < tokenUntil) return Promise.resolve(token);
    return new Promise(function (resolve, reject) {
      if (!tokenClient || tokenClientId !== config.clientId) {
        tokenClientId = config.clientId;
        tokenClient = root.google.accounts.oauth2.initTokenClient({ client_id: config.clientId, scope: SCOPE, callback: function () {} });
      }
      tokenClient.callback = function (response) {
        if (response && response.access_token) {
          token = response.access_token;
          tokenUntil = Date.now() + Math.max(60, (+response.expires_in || 3600) - 120) * 1000;
          resolve(token);
        } else reject(new Error(response && response.error === 'access_denied' ? 'Google Drive access was not allowed.' : 'Google sign-in failed.'));
      };
      tokenClient.error_callback = function (error) {
        reject(new Error(error && error.type === 'popup_closed' ? 'cancelled' : 'Google sign-in pop-up was blocked or closed.'));
      };
      tokenClient.requestAccessToken({ prompt: '' });
    });
  }

  function choose(config, oauth, mimeTypes) {
    var picker = root.google.picker;
    return new Promise(function (resolve) {
      // Tabs like Google Drive itself: My Drive (with its folders), Shared
      // with me, Shared drives, Starred, Upload. Methods a Picker version
      // lacks are skipped.
      var call = function (target, method) {
        if (typeof target[method] === 'function') target[method].apply(target, Array.prototype.slice.call(arguments, 2));
        return target;
      };
      var tab = function (label, setup) {
        var v = new picker.DocsView(picker.ViewId.DOCS);
        call(v, 'setIncludeFolders', true); call(v, 'setSelectFolderEnabled', false); call(v, 'setMimeTypes', (mimeTypes && mimeTypes.length ? mimeTypes : MIME_TYPES).join(','));
        setup(v);
        return call(v, 'setLabel', label);
      };
      var builder = new picker.PickerBuilder()
        .addView(tab('My Drive', function (v) { call(v, 'setParent', 'root'); }))
        .addView(tab('Shared with me', function (v) { call(v, 'setOwnedByMe', false); }))
        .addView(tab('Shared drives', function (v) { call(v, 'setEnableDrives', true); }))
        .addView(tab('Starred', function (v) { call(v, 'setStarred', true); }))
        .addView(new picker.DocsUploadView())
        .setOAuthToken(oauth)
        .setDeveloperKey(config.apiKey)
        .setTitle('Choose a file for your flipbook')
        .setCallback(function (data) {
          var action = data[picker.Response.ACTION];
          if (action === picker.Action.PICKED) resolve(data[picker.Response.DOCUMENTS][0]);
          else if (action === picker.Action.CANCEL) resolve(null);
        });
      if (picker.Feature && picker.Feature.SUPPORT_DRIVES && builder.enableFeature) builder.enableFeature(picker.Feature.SUPPORT_DRIVES);
      if (config.appId) builder.setAppId(config.appId);
      var lang = (document.documentElement.lang || '').slice(0, 2);
      if (lang) builder.setLocale(lang);
      builder.build().setVisible(true);
    });
  }

  // The Drive file as a File: Google Docs exported as PDF, the rest as is.
  function download(doc, oauth, fetcher) {
    var id = doc[root.google.picker.Document.ID], name = doc[root.google.picker.Document.NAME] || 'document';
    var mime = doc[root.google.picker.Document.MIME_TYPE] || '';
    var exported = GOOGLE_DOCS[mime];
    var url = 'https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(id) +
      (exported ? '/export?mimeType=' + encodeURIComponent(exported) : '?alt=media&supportsAllDrives=true');
    return (fetcher || root.fetch)(url, { headers: { Authorization: 'Bearer ' + oauth } }).then(function (response) {
      if (response.ok) return response.blob();
      if (response.status === 401) token = null;
      // Say what Google says: "API not enabled", "export too large", no access…
      return (response.json ? response.json() : Promise.reject()).catch(function () { return {}; }).then(function (body) {
        var error = (body && body.error) || {};
        var reason = ((error.errors || [])[0] || {}).reason || ((error.details || [])[0] || {}).reason || '';
        var said = String(error.message || '');
        if (/accessNotConfigured|SERVICE_DISABLED/i.test(reason) || /has not been used|is disabled/i.test(said))
          throw new Error('Google Drive API is not turned on for this app yet (Google Cloud → APIs & Services → Library → Google Drive API → Enable).');
        if (exported && /exportSizeLimitExceeded/i.test(reason + ' ' + said))
          throw new Error(name + ' is too large for Google to export as PDF. Download it as PDF from Google Drive and upload it.');
        throw new Error('Google Drive refused the download (' + response.status + (said ? ': ' + said : '') + ').');
      });
    }).then(function (blob) {
      var fileName = exported ? name.replace(/\.pdf$/i, '') + '.pdf' : name;
      // Drive's own type: downloads often come back as application/octet-stream.
      return new File([blob], fileName, { type: exported || mime || blob.type });
    });
  }

  function escapeHtml(text) {
    return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  // multipart/related body for files.create with media (uploadType=multipart).
  function multipart(title, html) {
    const boundary = 'myflipbook' + Math.random().toString(36).slice(2) + Date.now().toString(36);
    const meta = JSON.stringify({ name: title, mimeType: 'application/vnd.google-apps.document' });
    return { boundary: boundary, type: 'multipart/related; boundary=' + boundary,
      body: '--' + boundary + '\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n' + meta
        + '\r\n--' + boundary + '\r\nContent-Type: text/html; charset=UTF-8\r\n\r\n' + html
        + '\r\n--' + boundary + '--' };
  }
  /* Creates a Google Doc titled `title` in the reader's own Drive, holding a
   * clickable share link: opened from Drive it previews natively, one click
   * reaches the player. Resolves {id, name, url}, or null when cancelled. */
  function createDoc(config, title, url, status, fetcher) {
    status = status || function () {};
    var clean = String(title || 'Book').slice(0, 120) || 'Book';
    var link = String(url || '');
    var html = '<h1>' + escapeHtml(clean) + '</h1><p><a href="' + escapeHtml(link) + '">' + escapeHtml(link) + '</a></p>';
    var send = fetcher || root.fetch;
    return preload()
      .then(function () { status('Signing in to Google…'); return accessToken(config); })
      .then(function (oauth) {
        var part = multipart(clean, html);
        return send('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink,mimeType',
          { method: 'POST', headers: { Authorization: 'Bearer ' + oauth, 'Content-Type': part.type }, body: part.body });
      })
      .then(function (response) {
        if (response.ok) return response.json();
        if (response.status === 401) token = null;
        return (response.json ? response.json() : Promise.reject()).catch(function () { return {}; }).then(function (body) {
          var error = (body && body.error) || {};
          throw new Error('Google Drive refused the document (' + response.status + (error.message ? ': ' + error.message : '') + ').');
        });
      })
      .then(function (file) { return { id: file.id, name: file.name, url: file.webViewLink }; })
      .catch(function (cause) {
        if (cause && cause.message === 'cancelled') { status(''); return null; }
        throw cause;
      });
  }
  /* Opens the picker; resolves the picked file as a File, or null when the
   * reader cancels. status(text) reports progress. options.mimeTypes: only
   * these kinds of files (default: everything a flipbook can be made from). */
  function pick(config, status, options) {
    status = status || function () {};
    var only = options && options.mimeTypes;
    var oauth;
    return preload()
      .then(function () { status('Signing in to Google…'); return accessToken(config); })
      .then(function (value) { oauth = value; status('Choose a file in Google Drive…'); return choose(config, oauth, only); })
      .then(function (doc) {
        if (!doc) { status(''); return null; }
        status('Downloading ' + (doc[root.google.picker.Document.NAME] || 'the file') + ' from Google Drive…');
        return download(doc, oauth);
      })
      .catch(function (cause) {
        if (cause && cause.message === 'cancelled') { status(''); return null; }
        throw cause;
      });
  }

  root.DrivePicker = { preload: preload, pick: pick, download: download, createDoc: createDoc, MIME_TYPES: MIME_TYPES, SCOPE: SCOPE };
})(typeof window !== 'undefined' ? window : globalThis);
