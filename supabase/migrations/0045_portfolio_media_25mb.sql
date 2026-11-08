-- Portfolio add-on: the public "portfolio-media" bucket allows files up to 25 MB (audio and ZIP).
-- The publish engine still enforces 10 MB for images, documents and text; only audio and ZIP may be bigger.
update storage.buckets set file_size_limit = 26214400 where id = 'portfolio-media';
