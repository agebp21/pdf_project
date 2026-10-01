// "Add source → Google Drive": Google's scripts loaded once, drive.file token
// (reused until it expires), the Picker set up with key / app id / file types,
// Google Docs exported as PDF, other files downloaded as they are, cancel and
// errors. Google's libraries are stand-ins here.
const assert = require('node:assert/strict');
const fs = require('node:fs');

const loaded = [];
const requests = [];
let pickerReply = null, tokenReply = {access_token: 'tok-1', expires_in: 3600}, builderState = null;
global.document = {
  documentElement: {lang: 'id'},
  createElement: () => ({}),
  head: {appendChild(s) { loaded.push(s.src); setTimeout(() => s.onload(), 0); }},
};
global.window = global;
global.File = class { constructor(parts, name, opts) { this.parts = parts; this.name = name; this.type = opts.type; } };
global.gapi = {load(name, opts) { assert.equal(name, 'picker'); setTimeout(opts.callback, 0); }};
const picker = {
  ViewId: {DOCS: 'docs'}, Action: {PICKED: 'picked', CANCEL: 'cancel'},
  Response: {ACTION: 'action', DOCUMENTS: 'docs'}, Document: {ID: 'id', NAME: 'name', MIME_TYPE: 'mimeType'},
  DocsView: class { constructor(id) { this.id = id; } setIncludeFolders() { return this; } setSelectFolderEnabled() { return this; } setMimeTypes(m) { this.mimes = m; return this; } },
  DocsUploadView: class {},
  PickerBuilder: class {
    constructor() { builderState = this; this.views = []; }
    addView(v) { this.views.push(v); return this; } setOAuthToken(t) { this.token = t; return this; } setDeveloperKey(k) { this.key = k; return this; }
    setTitle() { return this; } setAppId(a) { this.appId = a; return this; } setLocale(l) { this.locale = l; return this; }
    setCallback(cb) { this.cb = cb; return this; }
    build() { const self = this; return {setVisible() { setTimeout(() => self.cb(pickerReply), 0); }}; }
  },
};
let tokenRequests = 0;
global.google = {picker, accounts: {oauth2: {initTokenClient(opts) {
  assert.equal(opts.scope, 'https://www.googleapis.com/auth/drive.file', 'only the files the reader picks');
  assert.equal(opts.client_id, 'client-1');
  const client = {requestAccessToken() { tokenRequests++; setTimeout(() => tokenReply.error_type ? client.error_callback({type: tokenReply.error_type}) : client.callback(tokenReply), 0); }};
  return client;
}}}};
let fetchReply = {ok: true, status: 200};
global.fetch = async (url, opts) => { requests.push([url, opts.headers.Authorization]); return {...fetchReply, blob: async () => ({type: 'application/octet-stream'})}; };

eval(fs.readFileSync(require('node:path').join(__dirname, '../assets/drive-picker.js'), 'utf8'));
const config = {clientId: 'client-1', apiKey: 'key-1', appId: '123456'};

(async () => {
  // A Google Doc: exported as PDF, named .pdf, title from the doc name.
  pickerReply = {action: 'picked', docs: [{id: 'doc 1', name: 'Laporan Tahunan', mimeType: 'application/vnd.google-apps.document'}]};
  const said = [];
  let file = await DrivePicker.pick(config, t => said.push(t));
  assert.deepEqual(loaded, ['https://apis.google.com/js/api.js', 'https://accounts.google.com/gsi/client']);
  assert.equal(builderState.key, 'key-1'); assert.equal(builderState.appId, '123456'); assert.equal(builderState.token, 'tok-1'); assert.equal(builderState.locale, 'id');
  assert.ok(builderState.views[0].mimes.includes('application/pdf') && builderState.views[0].mimes.includes('application/vnd.google-apps.presentation'));
  assert.deepEqual(requests.pop(), ['https://www.googleapis.com/drive/v3/files/doc%201/export?mimeType=application%2Fpdf', 'Bearer tok-1']);
  assert.equal(file.name, 'Laporan Tahunan.pdf'); assert.equal(file.type, 'application/pdf');
  assert.ok(said.some(t => /Downloading Laporan Tahunan/.test(t)));
  // A PDF: downloaded as is; the token is reused, scripts not loaded twice.
  pickerReply = {action: 'picked', docs: [{id: 'f2', name: 'buku.pdf', mimeType: 'application/pdf'}]};
  file = await DrivePicker.pick(config);
  assert.equal(tokenRequests, 1, 'one sign-in while the token is valid');
  assert.equal(loaded.length, 2);
  assert.deepEqual(requests.pop(), ['https://www.googleapis.com/drive/v3/files/f2?alt=media&supportsAllDrives=true', 'Bearer tok-1']);
  assert.equal(file.name, 'buku.pdf'); assert.equal(file.type, 'application/pdf');
  // Cancel in the picker -> null.
  pickerReply = {action: 'cancel'};
  assert.equal(await DrivePicker.pick(config), null);
  // Google's own reason is shown: export too large, Drive API not turned on, anything else.
  const refused = (status, reason, message) => ({ok: false, status, json: async () => ({error: {code: status, message, errors: [{reason}]}})});
  pickerReply = {action: 'picked', docs: [{id: 'big', name: 'Besar', mimeType: 'application/vnd.google-apps.presentation'}]};
  fetchReply = refused(403, 'exportSizeLimitExceeded', 'This file is too large to be exported.');
  await assert.rejects(DrivePicker.pick(config), /Besar is too large for Google to export/);
  fetchReply = refused(403, 'accessNotConfigured', 'Google Drive API has not been used in project 455 before or it is disabled.');
  await assert.rejects(DrivePicker.pick(config), /Google Drive API is not turned on/);
  fetchReply = refused(403, 'insufficientFilePermissions', 'The user does not have sufficient permissions for this file.');
  await assert.rejects(DrivePicker.pick(config), /refused the download \(403: The user does not have sufficient permissions/);
  fetchReply = {ok: false, status: 403};                       // no JSON body
  await assert.rejects(DrivePicker.pick(config), /refused the download \(403\)/, 'a 403 is not called "too large" without Google saying so');
  // An expired/revoked token (401) asks to sign in again next time.
  fetchReply = {ok: false, status: 401};
  pickerReply = {action: 'picked', docs: [{id: 'x', name: 'x.pdf', mimeType: 'application/pdf'}]};
  await assert.rejects(DrivePicker.pick(config), /refused the download \(401\)/);
  fetchReply = {ok: true, status: 200};
  await DrivePicker.pick(config);
  assert.equal(tokenRequests, 2, 'signed in again after a 401');
  console.log('PASS drive picker: scripts once, drive.file token reuse, Docs exported as PDF, files as is, cancel, Google reasons (export too large, Drive API off, other), 401 re-sign-in');
})().catch(error => { console.error(error); process.exit(1); });
