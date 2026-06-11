import path from 'path';

export const uploadRoot = process.env.UPLOAD_DIR
  ? path.resolve(process.env.UPLOAD_DIR)
  : path.resolve(process.cwd(), 'uploads');

export const legacyUploadRoots = [
  path.resolve(__dirname, '..', 'uploads'),
  path.resolve(__dirname, '..', '..', 'uploads')
].filter((candidate) => candidate !== uploadRoot);
