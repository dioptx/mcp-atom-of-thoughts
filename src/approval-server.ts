import * as http from 'node:http';
import { ApprovalResult } from './types.js';

export interface ApprovalRecord extends ApprovalResult {
  sessionId: string;
  receivedAt: number;
}

interface ApprovalPostBody {
  sessionId?: string;
  status?: ApprovalResult['status'];
  title?: string;
  phases?: Record<string, string>;
  rejections?: Array<{ nodeId: string; feedback: string }>;
  approvedNodes?: string[];
  timestamp?: string;
}

/**
 * Local HTTP server that receives approval POSTs from the browser viz HTML.
 * Listens on 127.0.0.1 + ephemeral port. Stores approvals keyed by sessionId.
 * Falls through to file-based approval polling if listen() fails.
 */
export class ApprovalCallbackServer {
  private server: http.Server | null = null;
  private boundPort: number = 0;
  private approvals: Map<string, ApprovalRecord[]> = new Map();

  async start(): Promise<{ port: number; url: string } | null> {
    return new Promise((resolve) => {
      const srv = http.createServer((req, res) => this.handleRequest(req, res));

      srv.once('error', () => resolve(null));

      srv.listen(0, '127.0.0.1', () => {
        const addr = srv.address();
        if (typeof addr === 'object' && addr) {
          this.server = srv;
          this.boundPort = addr.port;
          resolve({ port: addr.port, url: `http://127.0.0.1:${addr.port}/approval` });
        } else {
          resolve(null);
        }
      });
    });
  }

  private handleRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
    // CORS for file:// origin
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(204).end();
      return;
    }

    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', port: this.boundPort }));
      return;
    }

    if (req.method !== 'POST' || req.url !== '/approval') {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found. Use POST /approval' }));
      return;
    }

    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) {
        req.destroy();
      }
    });
    req.on('end', () => {
      try {
        const parsed = JSON.parse(body) as ApprovalPostBody;
        const sessionId = parsed.sessionId && parsed.sessionId.length > 0 ? parsed.sessionId : 'default';
        const record: ApprovalRecord = {
          status: parsed.status ?? 'PENDING',
          timestamp: parsed.timestamp,
          title: parsed.title,
          phases: parsed.phases,
          rejections: parsed.rejections,
          approvedNodes: parsed.approvedNodes,
          sessionId,
          receivedAt: Date.now(),
        };
        this.pushApproval(record);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok', sessionId }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
      }
    });
  }

  getCallbackUrl(): string | null {
    return this.boundPort ? `http://127.0.0.1:${this.boundPort}/approval` : null;
  }

  getPort(): number {
    return this.boundPort;
  }

  getApprovals(sessionId: string): ApprovalRecord[] {
    return [...(this.approvals.get(sessionId) || [])];
  }

  pushApproval(record: ApprovalRecord): void {
    const list = this.approvals.get(record.sessionId) || [];
    list.push(record);
    this.approvals.set(record.sessionId, list);
  }

  clearApprovals(sessionId?: string): void {
    if (sessionId) this.approvals.delete(sessionId);
    else this.approvals.clear();
  }

  stop(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.server) return resolve();
      this.server.close(() => {
        this.server = null;
        this.boundPort = 0;
        resolve();
      });
    });
  }
}
