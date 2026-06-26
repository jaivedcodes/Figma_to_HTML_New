import express, { Request, Response } from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs-extra';
import archiver from 'archiver';
import crypto from 'crypto';
import os from 'os';

import { runGeneration, GenerationInput, ProgressEvent } from './generator';

const app  = express();
const PORT = process.env.PORT ?? 3000;

// ── Middleware ───────────────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

// ── In-memory job store ──────────────────────────────────────
interface Job {
  id:         string;
  status:     'pending' | 'running' | 'done' | 'error';
  logs:       ProgressEvent[];
  outputDir?: string;
  projectName?: string;
  error?:     string;
  createdAt:  number;
}

const jobs = new Map<string, Job>();

// Clean up jobs older than 30 minutes
setInterval(() => {
  const cutoff = Date.now() - 30 * 60 * 1000;
  for (const [id, job] of jobs.entries()) {
    if (job.createdAt < cutoff) {
      if (job.outputDir) fs.remove(job.outputDir).catch(() => {});
      jobs.delete(id);
    }
  }
}, 5 * 60 * 1000);

// ── POST /api/generate — start job ──────────────────────────
app.post('/api/generate', async (req: Request, res: Response) => {
  const { desktopUrl, mobileUrl, apiToken, projectName } = req.body as GenerationInput;

  if (!desktopUrl || !mobileUrl || !apiToken || !projectName) {
    res.status(400).json({ error: 'All fields are required.' });
    return;
  }

  const jobId = crypto.randomUUID();
  const job: Job = {
    id: jobId,
    status: 'pending',
    logs: [],
    createdAt: Date.now(),
  };
  jobs.set(jobId, job);

  // Start generation asynchronously
  setImmediate(async () => {
    job.status = 'running';
    try {
      const result = await runGeneration(
        { desktopUrl, mobileUrl, apiToken, projectName },
        (event: ProgressEvent) => { job.logs.push(event); }
      );
      job.status     = 'done';
      job.outputDir  = result.outputDir;
      job.projectName = result.projectName;
    } catch (err) {
      job.status = 'error';
      job.error  = String(err);
      job.logs.push({ type: 'error', message: String(err) });
    }
  });

  res.json({ jobId });
});

// ── GET /api/progress/:jobId — SSE stream ───────────────────
app.get('/api/progress/:jobId', (req: Request, res: Response) => {
  const job = jobs.get(req.params.jobId);
  if (!job) { res.status(404).json({ error: 'Job not found.' }); return; }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  let sent = 0;

  const flush = () => {
    while (sent < job.logs.length) {
      const evt = job.logs[sent++];
      res.write(`data: ${JSON.stringify(evt)}\n\n`);
    }

    if (job.status === 'done') {
      res.write(`data: ${JSON.stringify({ type: 'done', message: 'Generation complete!' })}\n\n`);
      res.end();
      return;
    }

    if (job.status === 'error') {
      res.write(`data: ${JSON.stringify({ type: 'error', message: job.error ?? 'Unknown error' })}\n\n`);
      res.end();
      return;
    }
  };

  flush();
  const interval = setInterval(() => {
    flush();
    if (job.status === 'done' || job.status === 'error') clearInterval(interval);
  }, 300);

  req.on('close', () => clearInterval(interval));
});

// ── GET /api/status/:jobId — poll status ────────────────────
app.get('/api/status/:jobId', (req: Request, res: Response) => {
  const job = jobs.get(req.params.jobId);
  if (!job) { res.status(404).json({ error: 'Job not found.' }); return; }
  res.json({ status: job.status, error: job.error });
});

// ── GET /api/download/:jobId — ZIP download ─────────────────
app.get('/api/download/:jobId', async (req: Request, res: Response) => {
  const job = jobs.get(req.params.jobId);
  if (!job) {
    res.status(404).json({ error: 'Job not found — it may have expired. Please generate again.' });
    return;
  }
  if (job.status !== 'done') {
    res.status(400).json({ error: 'Generation not complete yet.' });
    return;
  }
  if (!job.outputDir) {
    res.status(500).json({ error: 'Output directory not recorded. Please generate again.' });
    return;
  }
  if (!await fs.pathExists(job.outputDir)) {
    res.status(410).json({ error: 'Output files have expired. Please generate again.' });
    return;
  }

  const zipName   = `${job.projectName ?? 'website'}.zip`;
  const outputDir = job.outputDir;
  const folderName = job.projectName ?? 'website';

  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${zipName}"`);

  // Register finish handler BEFORE piping so it's never missed
  res.on('finish', () => {
    fs.remove(outputDir).catch(() => {});
    jobs.delete(job.id);
  });

  const archive = archiver('zip', { zlib: { level: 6 } });

  // Warning handler (e.g. ENOENT for missing optional files — non-fatal)
  archive.on('warning', (err) => {
    if (err.code !== 'ENOENT') console.error('[download] archiver warning:', err.message);
  });

  // Error handler — check headersSent to avoid "headers already sent" crash
  archive.on('error', (err: Error) => {
    console.error('[download] archiver error:', err.message);
    if (!res.headersSent) {
      res.status(500).json({ error: `Archive error: ${err.message}` });
    } else {
      res.destroy(err);
    }
  });

  archive.pipe(res);
  archive.directory(outputDir, folderName);

  try {
    await archive.finalize();
  } catch (err) {
    console.error('[download] finalize error:', err);
    if (!res.headersSent) {
      res.status(500).json({ error: `Failed to create ZIP: ${String(err)}` });
    }
  }
});

// ── Fallback → serve frontend ────────────────────────────────
app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// ── Start ────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n  ✦  Figma → HTML Generator`);
  console.log(`  →  Open in browser: http://localhost:${PORT}\n`);
});

export default app;
