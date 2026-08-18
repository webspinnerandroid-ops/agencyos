-- 084_kb_upload_mime_types.sql
-- The tenant-assets bucket was created in 004 with an image-only
-- allowed_mime_types whitelist. Knowledgebase uploads (docx, pdf, txt, md,
-- csv, videos) are rejected by Supabase Storage with
-- "mime type ... is not supported" before our extraction code ever runs.
-- Widen the whitelist to cover everything the upload input accepts.

UPDATE storage.buckets
SET allowed_mime_types = ARRAY[
  -- images
  'image/png',
  'image/svg+xml',
  'image/jpeg',
  'image/webp',
  'image/gif',
  -- documents
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/msword',
  'application/pdf',
  'text/plain',
  'text/markdown',
  'text/csv',
  -- videos
  'video/mp4',
  'video/quicktime',
  'video/webm'
],
file_size_limit = 104857600
WHERE id = 'tenant-assets';
-- 100 MB so PDFs and videos upload; previously 5 MB (which Supabase reports
-- as a confusing "resource not found" on oversize uploads).
