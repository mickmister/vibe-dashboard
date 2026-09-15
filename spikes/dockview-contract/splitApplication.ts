export type DurablePortName = 'coordinator' | 'serializer' | 'fromJSON' | 'repository' | 'revision' | 'history' | 'autosave';
export type DurablePorts = Record<DurablePortName, (operation: string) => never>;
export type SplitOperation = 'enter' | 'resize' | 'maximize-left' | 'maximize-right' | 'restore' | 'narrow' | 'wide' | 'invalidate' | 'exit';
export type SplitPorts = Record<SplitOperation, () => unknown>;

/** Production-shaped scope gate: transient operations have no path to Voyage ports. */
export function createSplitApplication(ports: { durable: DurablePorts; split: SplitPorts }) {
  return {
    dispatch(operation: SplitOperation) { return ports.split[operation](); },
    dispatchDurableForControl(port: DurablePortName, operation: string) { return ports.durable[port](operation); },
  };
}
