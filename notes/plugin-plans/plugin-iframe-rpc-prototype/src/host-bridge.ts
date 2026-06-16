import {
  createPluginIframeRpcEnvelope,
  type JsonRpcFailure,
  type JsonRpcMessage,
  type JsonRpcRequest,
  type JsonValue,
  parsePluginIframeRpcEnvelope,
} from './protocol';

export type WindowLike = {
  postMessage: (message: unknown, targetOrigin: string) => void;
};

export type MessageEventLike = {
  data: unknown;
  source: WindowLike | null;
};

export type PluginFrameRegistration = {
  pluginId: string;
  frameId: string;
  nonce: string;
  targetWindow: WindowLike;
};

export type PluginContribution = {
  pluginId: string;
  slot: string;
  data: JsonValue;
};

export type PluginIframeHostBridgeOptions = {
  targetOrigin?: string;
};

export class PluginIframeHostBridge {
  private readonly frames = new Map<string, PluginFrameRegistration>();
  private readonly contributions: PluginContribution[] = [];
  private readonly targetOrigin: string;

  constructor(options: PluginIframeHostBridgeOptions = {}) {
    this.targetOrigin = options.targetOrigin ?? '*';
  }

  registerFrame(registration: PluginFrameRegistration): void {
    this.frames.set(registration.frameId, registration);
  }

  unregisterFrame(frameId: string): void {
    this.frames.delete(frameId);
  }

  getContributions(): PluginContribution[] {
    return [...this.contributions];
  }

  send(frameId: string, data: JsonRpcMessage): boolean {
    const frame = this.frames.get(frameId);
    if (!frame) return false;

    frame.targetWindow.postMessage(
      createPluginIframeRpcEnvelope({
        pluginId: frame.pluginId,
        frameId: frame.frameId,
        nonce: frame.nonce,
        data,
      }),
      this.targetOrigin,
    );
    return true;
  }

  receive(event: MessageEventLike): JsonRpcMessage | null {
    const envelope = parsePluginIframeRpcEnvelope(event.data);
    if (!envelope) return null;

    const frame = this.frames.get(envelope.frameId);
    if (!frame) return null;
    if (frame.targetWindow !== event.source) return null;
    if (frame.pluginId !== envelope.pluginId) return null;
    if (frame.nonce !== envelope.nonce) return null;

    return this.handleTrustedMessage(envelope.data, frame);
  }

  private handleTrustedMessage(
    message: JsonRpcMessage,
    frame: PluginFrameRegistration,
  ): JsonRpcMessage | null {
    if (!isRequest(message)) return message;

    if (message.method === 'contribution.register') {
      const params = message.params;
      if (!isContributionParams(params)) {
        return createError(message.id, -32602, 'Invalid contribution.register params');
      }

      this.contributions.push({
        pluginId: frame.pluginId,
        slot: params.slot,
        data: params.data,
      });

      return {
        jsonrpc: '2.0',
        id: message.id,
        result: { ok: true },
      };
    }

    return createError(message.id, -32601, `Method not found: ${message.method}`);
  }
}

function isRequest(message: JsonRpcMessage): message is JsonRpcRequest {
  return 'method' in message;
}

function isContributionParams(
  value: JsonValue | undefined,
): value is { slot: string; data: JsonValue } {
  return (
    value !== undefined &&
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    typeof value.slot === 'string' &&
    value.slot.length > 0 &&
    'data' in value
  );
}

function createError(id: string | number, code: number, message: string): JsonRpcFailure {
  return {
    jsonrpc: '2.0',
    id,
    error: {
      code,
      message,
    },
  };
}
