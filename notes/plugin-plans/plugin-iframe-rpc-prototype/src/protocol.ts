export const PLUGIN_IFRAME_RPC_PROTOCOL_VERSION = 1;
export const PLUGIN_IFRAME_RPC_MESSAGE_TYPE = 'vd-plugin-rpc/message';

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export type JsonRpcId = string | number;

export type JsonRpcRequest = {
  jsonrpc: '2.0';
  id: JsonRpcId;
  method: string;
  params?: JsonValue;
};

export type JsonRpcSuccess = {
  jsonrpc: '2.0';
  id: JsonRpcId;
  result: JsonValue;
};

export type JsonRpcFailure = {
  jsonrpc: '2.0';
  id: JsonRpcId | null;
  error: {
    code: number;
    message: string;
    data?: JsonValue;
  };
};

export type JsonRpcMessage = JsonRpcRequest | JsonRpcSuccess | JsonRpcFailure;

export type PluginIframeRpcEnvelope = {
  type: typeof PLUGIN_IFRAME_RPC_MESSAGE_TYPE;
  protocolVersion: typeof PLUGIN_IFRAME_RPC_PROTOCOL_VERSION;
  pluginId: string;
  frameId: string;
  nonce: string;
  data: JsonRpcMessage;
};

export function createPluginIframeRpcEnvelope(args: {
  pluginId: string;
  frameId: string;
  nonce: string;
  data: JsonRpcMessage;
}): PluginIframeRpcEnvelope {
  return {
    type: PLUGIN_IFRAME_RPC_MESSAGE_TYPE,
    protocolVersion: PLUGIN_IFRAME_RPC_PROTOCOL_VERSION,
    pluginId: args.pluginId,
    frameId: args.frameId,
    nonce: args.nonce,
    data: args.data,
  };
}

export function parsePluginIframeRpcEnvelope(value: unknown): PluginIframeRpcEnvelope | null {
  if (!isRecord(value)) return null;
  if (value.type !== PLUGIN_IFRAME_RPC_MESSAGE_TYPE) return null;
  if (value.protocolVersion !== PLUGIN_IFRAME_RPC_PROTOCOL_VERSION) return null;
  if (typeof value.pluginId !== 'string' || value.pluginId.length === 0) return null;
  if (typeof value.frameId !== 'string' || value.frameId.length === 0) return null;
  if (typeof value.nonce !== 'string' || value.nonce.length === 0) return null;
  if (!isJsonRpcMessage(value.data)) return null;

  return value as PluginIframeRpcEnvelope;
}

export function isJsonValue(value: unknown): value is JsonValue {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return typeof value !== 'number' || Number.isFinite(value);
  }

  if (Array.isArray(value)) {
    return value.every(isJsonValue);
  }

  if (!isRecord(value)) {
    return false;
  }

  return Object.values(value).every(isJsonValue);
}

function isJsonRpcMessage(value: unknown): value is JsonRpcMessage {
  if (!isRecord(value)) return false;
  if (value.jsonrpc !== '2.0') return false;

  if ('method' in value) {
    return (
      typeof value.method === 'string' &&
      value.method.length > 0 &&
      isJsonRpcId(value.id) &&
      (!('params' in value) || isJsonValue(value.params))
    );
  }

  if ('result' in value) {
    return isJsonRpcId(value.id) && isJsonValue(value.result);
  }

  if ('error' in value) {
    return (
      (isJsonRpcId(value.id) || value.id === null) &&
      isRecord(value.error) &&
      typeof value.error.code === 'number' &&
      Number.isInteger(value.error.code) &&
      typeof value.error.message === 'string' &&
      (!('data' in value.error) || isJsonValue(value.error.data))
    );
  }

  return false;
}

function isJsonRpcId(value: unknown): value is JsonRpcId {
  return typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
