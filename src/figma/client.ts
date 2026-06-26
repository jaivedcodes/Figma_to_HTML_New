import axios, { AxiosInstance } from 'axios';
import fs from 'fs-extra';
import path from 'path';
import { FigmaFile, FigmaImageResponse } from '../types/index';
import { FIGMA_API_BASE } from '../utils/config';
import { logger } from '../utils/logger';

export class FigmaClient {
  private http: AxiosInstance;

  constructor(private token: string) {
    this.http = axios.create({
      baseURL: FIGMA_API_BASE,
      headers: { 'X-Figma-Token': token },
      timeout: 60_000,
    });
  }

  async getFile(fileKey: string, nodeIds?: string[]): Promise<FigmaFile> {
    const params: Record<string, string> = {};
    if (nodeIds?.length) params['ids'] = nodeIds.join(',');

    const res = await withRetry(() =>
      this.http.get<FigmaFile>(`/files/${fileKey}`, { params, timeout: 120_000 })
    );
    return res.data;
  }

  async getImageUrls(
    fileKey: string,
    nodeIds: string[],
    format: 'png' | 'jpg' | 'svg' | 'pdf' = 'png',
    scale = 2
  ): Promise<Record<string, string | null>> {
    if (nodeIds.length === 0) return {};

    // Figma API accepts max 100 node IDs at once
    const chunks = chunkArray(nodeIds, 100);
    const result: Record<string, string | null> = {};

    for (const chunk of chunks) {
      const res = await withRetry(() =>
        this.http.get<FigmaImageResponse>(`/images/${fileKey}`, {
          params: {
            ids: chunk.join(','),
            format,
            scale,
            svg_include_id: true,
            svg_simplify_stroke: true,
            use_absolute_bounds: true,
          },
        })
      );

      if (res.data.err) {
        logger.warn(`Figma image API returned error: ${res.data.err}`);
      }

      Object.assign(result, res.data.images);
    }

    return result;
  }

  async downloadFile(url: string, destPath: string): Promise<void> {
    await fs.ensureDir(path.dirname(destPath));

    const res = await axios.get<Buffer>(url, {
      responseType: 'arraybuffer',
      timeout: 120_000,
      headers: { 'User-Agent': 'figma-to-html/1.0' },
    });

    await fs.writeFile(destPath, res.data);
  }

  async getFileImageRefs(
    fileKey: string,
    imageRefs: string[]
  ): Promise<Record<string, string>> {
    if (imageRefs.length === 0) return {};

    const res = await this.http.get<{ meta: { images: Record<string, string> } }>(
      `/files/${fileKey}/images`
    );

    const all = res.data.meta.images;
    const result: Record<string, string> = {};
    for (const ref of imageRefs) {
      if (all[ref]) result[ref] = all[ref];
    }
    return result;
  }

  async validateToken(): Promise<{ id: string; handle: string; email: string }> {
    const res = await this.http.get<{ id: string; handle: string; email: string }>('/me');
    return res.data;
  }
}

function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

// Retry up to 3 times on 429 (rate limit) with exponential backoff
async function withRetry<T>(fn: () => Promise<T>, maxAttempts = 3): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err: any) {
      lastErr = err;
      const status = err?.response?.status;
      if (status !== 429 || attempt === maxAttempts) throw err;

      // Honour Retry-After header if Figma sends one, else exponential backoff
      const retryAfter = err?.response?.headers?.['retry-after'];
      const waitMs = retryAfter
        ? Number.parseInt(retryAfter, 10) * 1000
        : Math.min(2 ** (attempt + 2) * 1000, 60_000); // 8s, 16s, 32s …

      logger.warn(`Figma API rate limited (429). Retrying in ${waitMs / 1000}s… (attempt ${attempt}/${maxAttempts})`);
      await new Promise((res) => setTimeout(res, waitMs));
    }
  }
  throw lastErr;
}

