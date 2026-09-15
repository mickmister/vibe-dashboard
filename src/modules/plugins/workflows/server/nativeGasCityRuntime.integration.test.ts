import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { PackagedNativeGasCityRuntime } from './nativeGasCityRuntime';
import { createHash } from 'node:crypto';

describe('packaged native Gas City runtime', () => {
  it.skipIf(process.env.VD_NATIVE_GAS_CITY_E2E !== '1')('requires exact pinned runtime and installs confirmed bytes durably', async () => {
    const base=await mkdtemp(join(tmpdir(),'vd-native-gc-'));const root=join(base,'runtime');const city=join(base,'city');await mkdir(root,{mode:0o700});await mkdir(city,{mode:0o700});
    const previous=process.env.VD_RUNTIME_ROOT;process.env.VD_RUNTIME_ROOT=base;
    try {
      const runtime=new PackagedNativeGasCityRuntime({root,city,target:'test-target',gcExecutable:'/usr/local/bin/gc',beadsExecutable:'/usr/local/bin/bd',vk:{} as any,resolver:{} as any});
      await expect(runtime.health()).resolves.toEqual({ready:true});
      const bytes=new TextEncoder().encode('{"formula":{"contents":"name = \\"native-proof\\"\\n"}}\n');const digest=createHash('sha256').update(bytes).digest('hex');
      await expect(runtime.ensureBundle({operationKey:'docker-proof',bundle:{schemaVersion:'vd.execution-bundle.v1',digest,bytes,document:{},verificationEvidence:{} as any}})).resolves.toEqual({bundleRef:digest});
      expect(await readFile(join(root,'bundles',digest,'bundle.json'),'utf8')).toContain('native-proof');
    } finally { if(previous===undefined)delete process.env.VD_RUNTIME_ROOT;else process.env.VD_RUNTIME_ROOT=previous;await rm(base,{recursive:true,force:true}); }
  });
});
