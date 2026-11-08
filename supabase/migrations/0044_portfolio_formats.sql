-- Portfolio add-on: the public "portfolio-media" bucket accepts more file types.
-- Before: PNG, JPEG, WebP, GIF, AVIF, PDF. Now also: SVG, Word / Excel / PowerPoint, OpenDocument (odt, ods, odp),
-- text (txt, csv, md, json, html - stored as text/plain), ZIP and audio (mp3, m4a).
-- The publish engine checks every file by its content before uploading (SVG with scripts, Office files with macros
-- and files that aren't what their name says are refused); this list is the second lock.
-- Additive and safe to run twice. Size limit stays 10 MB.
update storage.buckets
set allowed_mime_types = array[
  'image/png','image/jpeg','image/webp','image/gif','image/avif','image/svg+xml',
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.oasis.opendocument.text',
  'application/vnd.oasis.opendocument.spreadsheet',
  'application/vnd.oasis.opendocument.presentation',
  'text/plain','text/csv','text/markdown','application/json',
  'application/zip',
  'audio/mpeg','audio/mp4'
]
where id = 'portfolio-media';
