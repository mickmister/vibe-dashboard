import { createServer } from 'node:http';

export class FakeDiscordServer {
  readonly deliveries: unknown[] = [];
  private remainingFailures: number;
  private server = createServer(async (request, response) => {
    const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(Buffer.from(chunk));
    this.deliveries.push(JSON.parse(Buffer.concat(chunks).toString('utf8')));
    if (this.remainingFailures-- > 0) { response.writeHead(503); response.end('retry'); }
    else { response.writeHead(204); response.end(); }
  });
  url = '';
  constructor(failures = 0) { this.remainingFailures = failures; }
  async start(): Promise<this> {
    await new Promise<void>((resolve, reject) => { this.server.once('error', reject); this.server.listen(0, '127.0.0.1', resolve); });
    const address = this.server.address(); if (!address || typeof address === 'string') throw new Error('fake Discord did not bind');
    this.url = `http://127.0.0.1:${address.port}/webhook`; return this;
  }
  async stop(): Promise<void> { await new Promise<void>(resolve => this.server.close(() => resolve())); }
}
